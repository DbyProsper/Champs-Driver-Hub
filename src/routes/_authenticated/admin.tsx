import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LogOut, RefreshCw, Bike, Package, CheckCircle2, ChefHat, Clock, XCircle, Utensils, Sparkles, ShieldCheck, MessageCircle, Paintbrush, PanelLeftClose, PanelLeftOpen, TrendingUp } from "lucide-react";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { waLink, orderStatusMessage } from "@/lib/whatsapp";
import { fireNotification, requestNotificationPermissionIfNeeded } from "@/lib/notifications";
import { useBranch } from "@/lib/branch";
import { getAccessRole } from "@/lib/roles";
import { grantRoleByEmail } from "@/lib/admin.functions";
import { getDeliveryStatusForOrderStatus, resolveOrderDisplayStatus } from "@/lib/delivery";
import { logAdminAction } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Champs Chicken" }, { name: "robots", content: "noindex" }] }),
  component: Admin,
});

type Order = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  fulfillment: "pickup" | "delivery";
  delivery_notes: string | null;
  driver_id: string | null;
  subtotal_cents: number;
  status: "pending" | "preparing" | "ready" | "handed_to_driver" | "picked_up" | "on_the_way" | "out_for_delivery" | "completed" | "cancelled";
  created_at: string;
  branch_id: string;
  pickup_pin: string;
  verified_at: string | null;
};
type ItemRow = { order_id: string; item_name: string; quantity: number; unit_price_cents: number };

const PICKUP_STATUS_FLOW: Order["status"][] = ["pending", "preparing", "ready", "completed"];
const DELIVERY_STATUS_FLOW: Order["status"][] = ["pending", "preparing", "ready", "handed_to_driver"];
const STATUS_META = {
  pending: { label: "Received", icon: Clock, color: "bg-amber-500" },
  preparing: { label: "Preparing", icon: ChefHat, color: "bg-blue-500" },
  ready: { label: "Ready", icon: Package, color: "bg-emerald-500" },
  handed_to_driver: { label: "Handed to driver", icon: Bike, color: "bg-indigo-500" },
  out_for_delivery: { label: "Out for delivery", icon: Bike, color: "bg-purple-500" },
  completed: { label: "Delivered", icon: CheckCircle2, color: "bg-green-600" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "bg-neutral-500" },
} as const;

function isSameDay(createdAt: string, date: Date = new Date()) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return created.getFullYear() === date.getFullYear() && created.getMonth() === date.getMonth() && created.getDate() === date.getDate();
}

function Admin() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { branches, active: activeBranch, setActive } = useBranch();
  const [orders, setOrders] = useState<Order[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, ItemRow[]>>({});
  const [filter, setFilter] = useState<Order["status"] | "active" | "all">("active");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [checking, setChecking] = useState(true);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<"admin" | "staff">("admin");
  const [grantBusy, setGrantBusy] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [deliveryStatuses, setDeliveryStatuses] = useState<Record<string, string>>({});
  const [deliveryDriverIds, setDeliveryDriverIds] = useState<Record<string, string | null>>({});
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [manualPeak, setManualPeak] = useState<boolean>(false);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const prevStatusRef = useRef<Record<string, string>>({});

  async function load() {
    const [{ data: os }, { data: deliveryRows }] = await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("deliveries").select("order_id, status, driver_id"),
      supabase.from("delivery_settings").select("manual_peak_mode").eq("id", "default").maybeSingle(),
    ]);
    const list = (os as Order[]) ?? [];
    // Detect new pending orders for browser notifications + toast
    const newOnes = list.filter((o) => o.status === "pending" && !prevIdsRef.current.has(o.id));
    if (prevIdsRef.current.size > 0) {
      list.forEach((order) => {
        const previous = prevStatusRef.current[order.id];
        if (previous && previous !== order.status) {
          fireNotification("Order updated", `${order.order_number} · ${order.status.replaceAll("_", " ")}`, `admin-order-${order.id}-${order.status}`);
        }
      });
    }
    if (prevIdsRef.current.size > 0 && newOnes.length > 0) {
      newOnes.forEach((o) => {
        toast.success(`New order ${o.order_number} · ${o.customer_name}`);
        fireNotification("New Champs order", `${o.order_number} · ${formatZAR(o.subtotal_cents)}`, o.id);
      });
    }
    prevIdsRef.current = new Set(list.map((o) => o.id));
    prevStatusRef.current = Object.fromEntries(list.map((o) => [o.id, o.status]));
    setOrders(list);
    const statusMap: Record<string, string> = {};
    const driverIds = Array.from(new Set((deliveryRows ?? []).map((row: any) => row.driver_id).filter(Boolean)));
    if (driverIds.length) {
      const { data: drivers } = await supabase.from("drivers").select("id, name").in("id", driverIds);
      const names: Record<string, string> = {};
      for (const driver of (drivers ?? []) as Array<{ id: string; name: string }>) names[driver.id] = driver.name;
      setDriverNames(names);
    } else setDriverNames({});
    const driverMap: Record<string, string | null> = {};
    for (const row of (deliveryRows ?? []) as Array<{ order_id: string; status: string; driver_id: string | null }>) {
      if (row.order_id) statusMap[row.order_id] = row.status;
      if (row.order_id) driverMap[row.order_id] = row.driver_id;
    }
    setDeliveryStatuses(statusMap);
    setDeliveryDriverIds(driverMap);
    // delivery_settings (manual peak)
    try {
      // @ts-ignore
      const manual = (os && (await supabase.from("delivery_settings").select("manual_peak_mode").eq("id", "default").maybeSingle())) as any;
      if (manual && manual.data) setManualPeak(Boolean(manual.data.manual_peak_mode));
    } catch {}
    if (list.length) {
      const ids = list.map((o) => o.id);
      const { data: its } = await supabase.from("order_items").select("*").in("order_id", ids);
      const map: Record<string, ItemRow[]> = {};
      (its as ItemRow[] | null)?.forEach((r) => {
        (map[r.order_id] ??= []).push(r);
      });
      setItemsByOrder(map);
    }
  }

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      void requestNotificationPermissionIfNeeded();
      const r = await getAccessRole(u.user.id);
      setRole(r as any);
      setChecking(false);
      if (r) await load();
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("champs-admin-sidebar-collapsed");
      if (stored === "true") setSidebarCollapsed(true);
      else if (stored === "false") setSidebarCollapsed(false);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("champs-admin-sidebar-collapsed", sidebarCollapsed ? "true" : "false"); } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!role) return;
    const ch = supabase
      .channel("orders-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [role]);

  async function updateStatus(id: string, status: Order["status"]) {
    const current = orders.find((order) => order.id === id);
    // Prevent marking handed_to_driver when no driver is assigned to the delivery
    if (status === "handed_to_driver") {
      if (!deliveryDriverIds[id]) {
        toast.error("Cannot mark handed to driver: no driver assigned");
        return;
      }
    }
    const nextStatus = status === "handed_to_driver" ? "handed_to_driver" : status;
    const { error } = await supabase.from("orders").update({ status: nextStatus }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (current?.fulfillment === "delivery") {
      const deliveryStatus = status === "handed_to_driver"
        ? "handed_to_driver"
        : status === "cancelled"
        ? "cancelled"
        : getDeliveryStatusForOrderStatus(nextStatus);
      if (deliveryStatus) {
        await supabase.from("deliveries").update({ status: deliveryStatus } as never).eq("order_id", id);
      }
    }
    setOrders((prev) => prev.map((order) => (order.id === id ? { ...order, status: nextStatus } : order)));
    if (current?.fulfillment === "delivery" && status === "ready") {
      toast.success("Marked ready · driver can pick it up once it is handed over");
    } else if (current?.fulfillment === "delivery" && status === "handed_to_driver") {
      toast.success("Marked handed to driver · the driver can now start the handoff flow");
    } else {
      toast.success(`Marked ${STATUS_META[nextStatus].label}`);
    }
    void logAdminAction({
      action_type: status === "cancelled" ? "order_cancelled" : "order_status_changed",
      action_description: `Changed order ${current?.order_number ?? id} to ${nextStatus}`,
      target_type: "order",
      target_id: id,
      metadata: { before: current?.status ?? null, after: nextStatus, fulfillment: current?.fulfillment ?? null },
    });
  }

  async function verifyOrder(order: Order, pinAttempt: string) {
    if (pinAttempt.trim() !== order.pickup_pin) {
      toast.error("Wrong PIN");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("orders")
      .update({ verified_at: new Date().toISOString(), verified_by: u.user?.id, status: "completed" })
      .eq("id", order.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (order.fulfillment === "delivery") {
      await supabase.from("deliveries").update({ status: "delivered" } as never).eq("order_id", order.id);
    }
    toast.success(`Order ${order.order_number} verified & completed`);
    void logAdminAction({ action_type: "order_verified", action_description: `Verified and completed order ${order.order_number}`, target_type: "order", target_id: order.id, metadata: { before: order.status, after: "completed" } });
  }

  async function signOut() {
    await supabase.auth.signOut();
    nav({ to: "/auth" });
  }

  async function grantAccess(e: React.FormEvent) {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setGrantBusy(true);
    try {
      await grantRoleByEmail({ data: { email: grantEmail.trim(), role: grantRole } });
      toast.success(`${grantRole} access granted to ${grantEmail.trim()}`);
      setGrantEmail("");
    } catch (err: any) {
      toast.error(err.message ?? "Could not grant access");
    } finally {
      setGrantBusy(false);
    }
  }

  async function toggleManualPeak() {
    try {
      const { error } = await supabase.from("delivery_settings").update({ manual_peak_mode: !manualPeak } as any).eq("id", "default");
      if (error) throw error;
      setManualPeak(!manualPeak);
      toast.success(!manualPeak ? "Peak mode enabled" : "Peak mode disabled");
    } catch (err: any) {
      toast.error(err.message ?? "Could not toggle peak mode");
    }
  }

  if (pathname !== "/admin") {
    return <Outlet />;
  }

  if (checking) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  if (!role) {
    return (
      <div className="min-h-screen">
        <Header subtitle="Admin" />
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="font-display text-2xl">No staff access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account isn't assigned as staff or admin yet. Ask an admin to grant you access, then reload.
          </p>
          <button onClick={signOut} className="mt-6 rounded-full border px-4 py-2 text-sm">Sign out</button>
        </div>
      </div>
    );
  }

  const filtered = orders.filter((o) => {
    const displayStatus = resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]);
    if (branchFilter !== "all" && o.branch_id !== branchFilter) return false;
    if (filter === "all") return true;
    if (filter === "active") return displayStatus !== "completed" && displayStatus !== "cancelled";
    return displayStatus === filter;
  });

  const todayRevenueOrders = orders.filter((o) => {
    if (branchFilter !== "all" && o.branch_id !== branchFilter) return false;
    if (o.status === "cancelled") return false;
    return isSameDay(o.created_at);
  });

  const stats = {
    new: filtered.filter((o) => resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]) === "pending").length,
    prep: filtered.filter((o) => resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]) === "preparing").length,
    out: filtered.filter((o) => {
      const displayStatus = resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]);
      return displayStatus === "out_for_delivery" || displayStatus === "handed_to_driver" || displayStatus === "ready" || displayStatus === "picked_up" || displayStatus === "on_the_way";
    }).length,
    revenue: todayRevenueOrders.reduce((sum, o) => sum + o.subtotal_cents, 0),
  };

  return (
    <div className="min-h-screen pb-10 bg-muted/40">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 gap-2">
          <Link to="/" className="font-display text-2xl text-brand flex items-center gap-2">
            <img src="/images/champs/champs-logo.png" alt="Champs Chicken" className="h-8 w-auto" />
            <span>Champs Admin</span>
          </Link>
          <div className="flex items-center gap-2">
            {/* Small-screen quick links (hidden on large screens where sidebar appears) */}
            <Link to="/admin/promotions" className="inline-flex md:hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
              <Sparkles className="h-3.5 w-3.5" /> Promos
            </Link>
            <Link to="/admin/menu" className="inline-flex md:hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
              <Utensils className="h-3.5 w-3.5" /> Menu
            </Link>
            <Link to="/admin/appearance" className="inline-flex md:hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
              <Paintbrush className="h-3.5 w-3.5" /> Appearance
            </Link>
            <Link to="/admin/deliveries" className="inline-flex md:hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
              <Bike className="h-3.5 w-3.5" /> Deliveries
            </Link>
            <Link to="/admin/revenue" className="inline-flex md:hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
              <TrendingUp className="h-3.5 w-3.5" /> Revenue
            </Link>
            <Link to="/admin/audit-trail" className="inline-flex md:hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
              <ShieldCheck className="h-3.5 w-3.5" /> Audit Trail
            </Link>
            <button onClick={load} className="grid h-8 w-8 place-items-center rounded-full border hover:bg-accent"><RefreshCw className="h-4 w-4" /></button>
            <button onClick={toggleManualPeak} title="Toggle peak mode" className={"grid h-8 w-8 place-items-center rounded-full border hover:bg-accent " + (manualPeak ? "bg-amber-500 text-white" : "")}>{manualPeak ? <Sparkles className="h-4 w-4" /> : <Clock className="h-4 w-4" />}</button>
            <button onClick={signOut} className="grid h-8 w-8 place-items-center rounded-full border hover:bg-accent"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="lg:flex lg:items-start lg:gap-6">
          <aside className="hidden md:block mb-4 w-full lg:mb-0 lg:w-56 lg:shrink-0">
            <div className="rounded-2xl border bg-card p-3 lg:sticky lg:top-[68px]">
              <div className="mb-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed((value) => !value)}
                  className="flex w-full items-center justify-center gap-2 rounded-md border bg-background px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent"
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
                  {!sidebarCollapsed && <span>Collapse</span>}
                </button>
                <button
                  type="button"
                  onClick={toggleManualPeak}
                  className={"flex w-full items-center justify-center gap-2 rounded-md border px-2 py-2 text-[11px] font-semibold uppercase tracking-wider " + (manualPeak ? "bg-amber-500 text-white" : "bg-background hover:bg-accent")}
                  title="Toggle peak mode"
                >
                  {manualPeak ? <Sparkles className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  {!sidebarCollapsed && (manualPeak ? "Peak on" : "Peak off")}
                </button>
              </div>
              <nav className="flex flex-wrap gap-2 lg:flex-col lg:gap-2">
                <Link to="/admin" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
                  <ShieldCheck className="h-4 w-4" /> {!sidebarCollapsed && "Orders"}
                </Link>
                <Link to="/admin/menu" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
                  <Utensils className="h-4 w-4" /> {!sidebarCollapsed && "Menu"}
                </Link>
                <Link to="/admin/promotions" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
                  <Sparkles className="h-4 w-4" /> {!sidebarCollapsed && "Promotions"}
                </Link>
                <Link to="/admin/appearance" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
                  <Paintbrush className="h-4 w-4" /> {!sidebarCollapsed && "Appearance"}
                </Link>
                <Link to="/admin/deliveries" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
                  <Bike className="h-4 w-4" /> {!sidebarCollapsed && "Deliveries"}
                </Link>
                <Link to="/admin/revenue" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
                  <TrendingUp className="h-4 w-4" /> {!sidebarCollapsed && "Revenue Overview"}
                </Link>
                <Link to="/admin/audit-trail" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
                  <ShieldCheck className="h-4 w-4" /> {!sidebarCollapsed && "Audit Trail"}
                </Link>
              </nav>
            </div>
          </aside>

          <main className="flex-1">
                      {role === "admin" && (
                        <form onSubmit={grantAccess} className="mb-4 flex gap-2">
                          <input
                            type="email"
                            value={grantEmail}
                            onChange={(event) => setGrantEmail(event.target.value)}
                            placeholder="staff@example.com"
                            className="min-w-52 flex-1 rounded-md border px-3 py-2 text-sm"
                          />
                          <select value={grantRole} onChange={(event) => setGrantRole(event.target.value as "admin" | "staff")} className="rounded-md border px-3 py-2 text-sm">
                            <option value="admin">Admin</option>
                            <option value="staff">Staff</option>
                          </select>
                          <button disabled={grantBusy} className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-brand-foreground disabled:opacity-60">
                            {grantBusy ? "Granting…" : "Grant access"}
                          </button>
                        </form>
                      )}

                      {/* Branch filter */}
        <div className="mb-3 flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Branch</span>
          <button
            onClick={() => setBranchFilter("all")}
            className={"rounded-full px-3 py-1 text-xs font-bold " + (branchFilter === "all" ? "bg-brand text-brand-foreground" : "bg-background border")}
          >
            All
          </button>
          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => { setBranchFilter(b.id); setActive(b); }}
              className={"rounded-full px-3 py-1 text-xs font-bold " + (branchFilter === b.id ? "bg-brand text-brand-foreground" : "bg-background border")}
            >
              {b.city}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="New" value={stats.new} tone="bg-amber-500" />
          <Stat label="Preparing" value={stats.prep} tone="bg-blue-500" />
          <Stat label="Out for delivery" value={stats.out} tone="bg-purple-500" />
          <Stat label="Today revenue" value={formatZAR(stats.revenue)} tone="bg-brand" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {([
            { value: "active", label: "Active" },
            { value: "pending", label: "Received" },
            { value: "preparing", label: "Preparing" },
            { value: "ready", label: "Ready" },
            { value: "handed_to_driver", label: "Handed to driver" },
            { value: "out_for_delivery", label: "Out for delivery" },
            { value: "completed", label: "Delivered" },
            { value: "all", label: "All" },
          ] as const).map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value as Order["status"] | "active" | "all")}
              className={
                "rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider " +
                (filter === f.value ? "bg-brand text-brand-foreground" : "bg-background border text-muted-foreground")
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {filtered.length === 0 && <div className="text-sm text-muted-foreground py-6">No orders in this view.</div>}
          {filtered.map((o) => {
            const branch = branches.find((b) => b.id === o.branch_id);
            return (
              <OrderCard
                key={o.id}
                order={o}
                items={itemsByOrder[o.id] ?? []}
                branchName={branch?.city ?? "—"}
                branchPhone={branch?.phone ?? null}
                deliveryStatus={deliveryStatuses[o.id]}
                deliveryDriverId={deliveryDriverIds[o.id]}
                driverName={o.driver_id ? driverNames[o.driver_id] : undefined}
                onUpdateStatus={updateStatus}
                onVerify={verifyOrder}
              />
            );
          })}
        </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function OrderCard({
  order: o, items, branchName, branchPhone, deliveryStatus, deliveryDriverId, driverName, onUpdateStatus, onVerify,
}: {
  order: Order; items: ItemRow[]; branchName: string; branchPhone: string | null; deliveryStatus?: string | null; deliveryDriverId?: string | null; driverName?: string;
  onUpdateStatus: (id: string, s: Order["status"]) => void;
  onVerify: (o: Order, pin: string) => void;
}) {
  const effectiveStatus = resolveOrderDisplayStatus(o.status, deliveryStatus) ?? o.status;
  const meta = STATUS_META[effectiveStatus];
  const StatusIcon = meta.icon;
  const statusFlow = o.fulfillment === "pickup" ? PICKUP_STATUS_FLOW : DELIVERY_STATUS_FLOW;
  const currentIdx = statusFlow.indexOf(effectiveStatus as Order["status"]);
  const next = currentIdx >= 0 && currentIdx < statusFlow.length - 1 ? statusFlow[currentIdx + 1] : null;
  const shouldShowNext = !(o.fulfillment === "delivery" && (effectiveStatus === "completed" || effectiveStatus === "cancelled"));
  const [pinInput, setPinInput] = useState("");
  const [showVerify, setShowVerify] = useState(false);

  const waHref = waLink(o.customer_phone, orderStatusMessage(o.order_number, effectiveStatus, o.customer_name));

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-2xl text-brand">{o.order_number}</div>
          <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleTimeString()} · {branchName}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white ${meta.color}`}>
            <StatusIcon className="h-3 w-3" /> {meta.label}
          </span>
          {o.verified_at && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[9px] font-bold uppercase text-white">
              <CheckCircle2 className="h-2.5 w-2.5" /> Verified
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 text-sm">
        <div className="font-semibold">{o.customer_name} · <span className="text-muted-foreground font-normal">{o.customer_phone}</span></div>
        <div className="mt-1 inline-flex items-center gap-1 text-xs">
          {o.fulfillment === "delivery" ? <Bike className="h-3 w-3" /> : <Package className="h-3 w-3" />}
          <span className="capitalize font-semibold">{o.fulfillment}</span>
        </div>
        {o.pickup_pin && (
          <div className="mt-2 inline-flex items-center rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand">
            PIN {o.pickup_pin}
          </div>
        )}
        {o.delivery_notes && <div className="mt-1 rounded-md bg-muted p-2 text-xs italic">{o.delivery_notes}</div>}
        {o.fulfillment === "delivery" && driverName && <div className="mt-1 text-xs text-muted-foreground">Driver: <span className="font-semibold text-foreground">{driverName}</span></div>}
      </div>
      <ul className="mt-3 text-sm space-y-0.5 border-t pt-3">
        {items.map((i, idx) => (
          <li key={idx} className="flex justify-between">
            <span><span className="font-bold text-brand">{i.quantity}×</span> {i.item_name}</span>
            <span className="tabular-nums text-muted-foreground">{formatZAR(i.unit_price_cents * i.quantity)}</span>
          </li>
        ))}
      </ul>

      {/* PIN verify */}
      {!o.verified_at && (effectiveStatus === "out_for_delivery" || effectiveStatus === "ready") && (
        <div className="mt-3 rounded-xl bg-brand/5 border border-brand/20 p-3">
          {!showVerify ? (
            <button onClick={() => setShowVerify(true)} className="w-full inline-flex items-center justify-center gap-2 text-xs font-bold text-brand">
              <ShieldCheck className="h-3.5 w-3.5" /> Verify customer PIN on handover
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="4-digit PIN"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="flex-1 rounded-md border px-3 py-2 text-sm tracking-widest text-center font-display"
              />
              <button
                onClick={() => { onVerify(o, pinInput); setPinInput(""); setShowVerify(false); }}
                className="rounded-full bg-brand px-3 py-2 text-xs font-bold text-brand-foreground"
              >
                Verify
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t pt-3 gap-2">
        <div className="font-display text-xl text-brand">{formatZAR(o.subtotal_cents)}</div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-2.5 py-1.5 text-[11px] font-bold text-white hover:opacity-90">
            <MessageCircle className="h-3 w-3" /> WA
          </a>
          {effectiveStatus !== "cancelled" && effectiveStatus !== "completed" && (
            <button onClick={() => onUpdateStatus(o.id, "cancelled")} className="rounded-full border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-brand">
              Cancel
            </button>
          )}
          {next && shouldShowNext && (
            <button
              onClick={() => onUpdateStatus(o.id, next)}
              disabled={next === "handed_to_driver" && !deliveryDriverId}
              title={next === "handed_to_driver" && !deliveryDriverId ? "Assign a driver before handing to driver" : undefined}
              className={
                "rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-brand-foreground hover:bg-brand-dark " +
                (next === "handed_to_driver" && !deliveryDriverId ? "opacity-50 cursor-not-allowed" : "")
              }
            >
              → {STATUS_META[next as keyof typeof STATUS_META].label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className={"inline-block h-2 w-6 rounded-full " + tone} />
      <div className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-2xl">{value}</div>
    </div>
  );
}
