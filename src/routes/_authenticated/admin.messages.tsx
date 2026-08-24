import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageCircle, History, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ChatDialog } from "@/components/ChatDialog";

export const Route = createFileRoute("/_authenticated/admin/messages")({
  head: () => ({ meta: [{ title: "Driver Messages — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: MessagesPage,
});

type Driver = { id: string; name: string; profile_image_url: string | null };
type OrderChat = { id: string; order_number: string; driver_id: string; customer_name: string; workflow_status: string };

function MessagesPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orders, setOrders] = useState<OrderChat[]>([]);
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [notificationConversationId, setNotificationConversationId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [{ data: driverRows }, { data: orderRows }] = await Promise.all([
      supabase.from("drivers").select("id,name,profile_image_url").order("name"),
      (supabase as any).from("orders").select("id,order_number,driver_id,customer_name,workflow_status").not("driver_id", "is", null).order("created_at", { ascending: false }).limit(200),
    ]);
    setDrivers((driverRows ?? []) as Driver[]);
    setOrders((orderRows ?? []) as OrderChat[]);
  }, []);
  useEffect(() => {
    const stored = sessionStorage.getItem("champs-admin-open-conversation");
    if (stored) { sessionStorage.removeItem("champs-admin-open-conversation"); setNotificationConversationId(stored); }
    void load();
    const channel = supabase.channel("admin-driver-message-directory")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);
  const rows = useMemo(() => drivers.map((driver) => ({ driver, orders: orders.filter((order) => order.driver_id === driver.id) })), [drivers, orders]);
  return <div className="min-h-screen bg-muted/40 pb-20">
    <header className="sticky top-0 z-30 border-b bg-background"><div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3"><Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Admin</Link><div className="inline-flex items-center gap-2 font-display text-xl text-brand"><MessageCircle className="h-5 w-5" /> Driver messages</div><div className="w-16" /></div></header>
    <main className="mx-auto max-w-4xl space-y-3 px-4 py-4">
      <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">Drivers are listed alphabetically. Use General for account or availability matters; order conversations remain clearly labelled.</div>
      {rows.length === 0 && <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No drivers yet.</div>}
      {rows.map(({ driver, orders: driverOrders }) => { const activeOrders = driverOrders.filter((order) => !["delivered", "cancelled", "rejected_by_driver"].includes(order.workflow_status)); const oldOrders = driverOrders.filter((order) => ["delivered", "cancelled", "rejected_by_driver"].includes(order.workflow_status)); return <section key={driver.id} className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-3">{driver.profile_image_url ? <img src={driver.profile_image_url} alt={driver.name} className="h-10 w-10 rounded-full object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-muted font-display text-brand">{driver.name.slice(0,1)}</div>}<div className="min-w-0 flex-1"><h2 className="font-display text-xl text-brand">{driver.name}</h2><div className="text-xs text-muted-foreground">{driverOrders.length} labelled order conversation{driverOrders.length === 1 ? "" : "s"}</div></div><ChatDialog audience="champs" driverId={driver.id} label="General" className="rounded-full bg-brand px-3 py-2 text-xs font-bold text-brand-foreground" /></div>
        {activeOrders.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{activeOrders.map((order) => <OrderConversation key={order.id} order={order} driverId={driver.id} />)}</div>}
        {oldOrders.length > 0 && <div className="mt-3"><button type="button" onClick={() => setHistoryOpen((current) => ({ ...current, [driver.id]: !current[driver.id] }))} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold"><History className="h-3.5 w-3.5" /> Conversation history ({oldOrders.length}) {historyOpen[driver.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</button>{historyOpen[driver.id] && <div className="mt-2 grid gap-2 sm:grid-cols-2">{oldOrders.map((order) => <OrderConversation key={order.id} order={order} driverId={driver.id} />)}</div>}</div>}
      </section>})}
      {notificationConversationId && <ChatDialog conversationId={notificationConversationId} audience="champs" label="Driver message" initialOpen hideTrigger onClose={() => setNotificationConversationId(null)} />}
    </main>
  </div>;
}

function OrderConversation({ order, driverId }: { order: OrderChat; driverId: string }) {
  return <div className="flex items-center justify-between gap-2 rounded-xl border p-3"><div className="min-w-0"><div className="font-semibold">Order {order.order_number}</div><div className="truncate text-[11px] text-muted-foreground">{order.customer_name} · {order.workflow_status.replaceAll("_", " ")}</div></div><ChatDialog audience="champs" orderId={order.id} driverId={driverId} label="Open" className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold" /></div>;
}
