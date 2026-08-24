import { supabase } from "@/integrations/supabase/client";

export async function sendOrderEventEmail(orderId: string, event: "created" | "accepted" | "submitted" | "preparing" | "ready" | "delivered") {
  if (import.meta.env.VITE_ORDER_EMAILS_ENABLED !== "true") return;
  const { error } = await supabase.functions.invoke("send-order-event", { body: { orderId, event } });
  if (error) console.warn("Order email could not be sent", error.message);
}
