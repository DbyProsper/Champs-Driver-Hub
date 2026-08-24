import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) throw new Error("Authentication required");
    const url = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const fromEmail = Deno.env.get("CHAMPS_FROM_EMAIL")!;
    if (!resendKey || !fromEmail) throw new Error("Email delivery is not configured");
    const caller = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } } });
    const { data: callerData } = await caller.auth.getUser();
    if (!callerData.user) throw new Error("Invalid session");
    const admin = createClient(url, serviceKey);
    const { orderId, event } = await request.json();
    const { data: order, error } = await admin.from("orders").select("id,order_number,user_id,driver_id,customer_name,workflow_status").eq("id", orderId).single();
    if (error || !order) throw error ?? new Error("Order not found");
    const { data: driver } = await admin.from("drivers").select("user_id").eq("id", order.driver_id).maybeSingle();
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerData.user.id);
    const isStaff = roles?.some((row) => row.role === "admin" || row.role === "staff");
    if (callerData.user.id !== order.user_id && callerData.user.id !== driver?.user_id && !isStaff) throw new Error("Not allowed");
    if (!order.user_id) return new Response(JSON.stringify({ skipped: "guest order" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const [{ data: customer }, driverAuth] = await Promise.all([
      admin.auth.admin.getUserById(order.user_id),
      driver?.user_id ? admin.auth.admin.getUserById(driver.user_id) : Promise.resolve({ data: { user: null } } as any),
    ]);
    if (!customer.user?.email) return new Response(JSON.stringify({ skipped: "no customer email" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const eventText: Record<string,string> = { created: "Your order has been sent to your driver.", accepted: "Your driver accepted your order.", submitted: "Your order was submitted to Champs.", preparing: "Champs is preparing your order.", ready: "Your order is ready for pickup.", delivered: "Your order has been delivered." };
    const message = eventText[event] ?? `Order status: ${order.workflow_status.replaceAll("_", " ")}`;
    const recipients = [customer.user.email];
    if (event === "ready" && driverAuth.data.user?.email) recipients.push(driverAuth.data.user.email);
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: fromEmail, to: recipients, subject: `Champs order ${order.order_number}`, text: `Hi,\n\n${message}\n\nOrder: ${order.order_number}\nCustomer: ${order.customer_name}\n\nChamps Chicken` }) });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${await response.text()}`);
    return new Response(JSON.stringify({ sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
