import { supabase } from "@/integrations/supabase/client";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export async function printOrderReceipt(orderId: string, jobId?: string) {
  const [{ data: order, error }, { data: items }] = await Promise.all([
    (supabase as any).from("orders").select("id,order_number,customer_name,created_at,submitted_to_champs_at,driver_id").eq("id", orderId).single(),
    (supabase as any).from("order_items").select("item_name,quantity").eq("order_id", orderId),
  ]);
  if (error || !order) throw error ?? new Error("Order not found");
  let driverName = "Unassigned";
  if (order.driver_id) {
    const { data: driver } = await (supabase as any).from("drivers").select("name").eq("id", order.driver_id).single();
    if (driver?.name) driverName = driver.name;
  }
  const receipt = window.open("", `champs-receipt-${order.id}`, "popup,width=420,height=700");
  if (!receipt) throw new Error("Allow popups to print this receipt");
  receipt.document.write(`<!doctype html><html><head><title>Champs ${escapeHtml(order.order_number)}</title><style>@page{size:80mm auto;margin:4mm}body{font-family:ui-monospace,monospace;width:72mm;margin:0;color:#000}h1{font-size:20px;text-align:center;margin:0 0 8px}.rule{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px;font-size:12px;margin:3px 0}.small{font-size:11px}strong{font-weight:800}@media print{button{display:none}}</style></head><body><h1>CHAMPS CHICKEN</h1><div class="rule"></div><div class="small"><strong>Order:</strong> ${escapeHtml(order.order_number)}</div><div class="small"><strong>Customer:</strong> ${escapeHtml(order.customer_name)}</div><div class="small"><strong>Driver:</strong> ${escapeHtml(driverName)}</div><div class="small"><strong>Submitted:</strong> ${escapeHtml(new Date(order.submitted_to_champs_at ?? order.created_at).toLocaleString())}</div><div class="rule"></div>${(items ?? []).map((item: any) => `<div class="row"><span>${escapeHtml(item.item_name)}</span><strong>x${Number(item.quantity)}</strong></div>`).join("")}<div class="rule"></div><div class="small" style="text-align:center">Prepared for driver collection</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));</script></body></html>`);
  receipt.document.close();
  if (jobId) await (supabase as any).from("receipt_print_jobs").update({ status: "printed", printed_at: new Date().toISOString() }).eq("id", jobId);
}
