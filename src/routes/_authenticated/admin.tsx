import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LogOut, RefreshCw, Bike, Package, CheckCircle2, ChefHat, Clock, XCircle, Utensils, Sparkles, ShieldCheck, MessageCircle, Paintbrush, PanelLeftClose, PanelLeftOpen, TrendingUp, Printer, Flag, LockKeyhole, Menu as MenuIcon, X, Loader2, Power } from "lucide-react";
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
import { NotificationCenter } from "@/components/NotificationCenter";
import { ChatDialog } from "@/components/ChatDialog";
import { printOrderReceipt } from "@/lib/receipt";
import { sendOrderEventEmail } from "@/lib/order-email";
import { UnreadNavigationBadge } from "@/components/UnreadNavigationBadge";
import { UnreadMessageBadge } from "@/components/UnreadMessageBadge";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  updated_at: string;
  branch_id: string;
  pickup_pin: string;
  verified_at: string | null;
  workflow_status?: string;
};
type ItemRow = { order_id: string; item_name: string; quantity: number; unit_price_cents: number };
type DriverReport = { id: string; order_id: string; driver_id: string; reason: string; details: string; status: string; created_at: string };

const PICKUP_STATUS_FLOW: Order["status"][] = ["pending", "preparing", "ready", "completed"];
const DELIVERY_STATUS_FLOW: Order["status"][] = ["pending", "preparing", "ready", "handed_to_driver"];
const STATUS_META = {
  pending: { label: "Received", icon: Clock, color: "bg-amber-500" },
  preparing: { label: "Preparing", icon: ChefHat, color: "bg-blue-500" },
  ready: { label: "Ready", icon: Package, color: "bg-emerald-500" },
  handed_to_driver: { label: "Handed to driver", icon: Bike, color: "bg-indigo-500" },
  out_for_delivery: { label: "Out for delivery", icon: Bike, color: "bg-purple-500" },
  picked_up: { label: "Picked up", icon: Bike, color: "bg-indigo-500" },
  on_the_way: { label: "Out for delivery", icon: Bike, color: "bg-purple-500" },
  completed: { label: "Completed", icon: CheckCircle2, color: "bg-green-600" },
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [deliveryStatuses, setDeliveryStatuses] = useState<Record<string, string>>({});
  const [deliveryDriverIds, setDeliveryDriverIds] = useState<Record<string, string | null>>({});
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [manualPeak, setManualPeak] = useState<boolean>(false);
  const [pickupEnabled, setPickupEnabled] = useState<boolean>(true);
  const [onlineOrderingOpen, setOnlineOrderingOpen] = useState(true);
  const [shopToggleBusy, setShopToggleBusy] = useState(false);
  const [duePromptOrder, setDuePromptOrder] = useState<Order | null>(null);
  const [reports, setReports] = useState<DriverReport[]>([]);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const prevStatusRef = useRef<Record<string, string>>({});

  async function load() {
    const [{ data: os }, { data: deliveryRows }, { data: settingRow }, { data: reportRows }, { data: shopRow }] = await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("deliveries").select("order_id, status, driver_id"),
      (supabase.from("delivery_settings") as any).select("manual_peak_mode,pickup_enabled,base_prep_min,auto_ready_mode").eq("id", "default").maybeSingle(),
      (supabase as any).from("driver_reports").select("id,order_id,driver_id,reason,details,status,created_at").in("status", ["open","reviewing"]).order("created_at", { ascending: false }),
      (supabase.from("site_settings") as any).select("online_ordering_open").eq("id", "main").maybeSingle(),
    ]);
    setOnlineOrderingOpen(shopRow?.online_ordering_open !== false);
    setManualPeak(Boolean((settingRow as any)?.manual_peak_mode));
    setPickupEnabled((settingRow as any)?.pickup_enabled !== false);
    setReports((reportRows ?? []) as DriverReport[]);
    const list = (os as Order[]) ?? [];
    if ((settingRow as any)?.auto_ready_mode === "automatic") {
      void (supabase.rpc as any)("advance_due_kitchen_orders");
    } else {
      const cutoff = Date.now() - Number((settingRow as any)?.base_prep_min ?? 25) * 60_000;
      setDuePromptOrder(list.find((order) => order.status === "preparing" && new Date(order.updated_at).getTime() <= cutoff) ?? null);
    }
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
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_reports" }, () => load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "site_settings", filter: "id=eq.main" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [role]);

  useEffect(() => {
    if (!role) return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [role]);

  useEffect(() => {
    if (!role) return;
    const channel = supabase.channel("receipt-print-jobs-admin")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "receipt_print_jobs" }, (payload) => {
        const job = payload.new as { id: string; order_id: string };
        void printOrderReceipt(job.order_id, job.id).catch((error) => toast.error(error.message));
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
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
    const workflowStatus = status === "preparing" ? "preparing" : status === "ready" ? "ready_for_pickup" : status === "completed" ? "delivered" : status === "cancelled" ? "cancelled" : undefined;
    const { error } = await (supabase.from("orders") as any).update({ status: nextStatus, ...(workflowStatus ? { workflow_status: workflowStatus } : {}) }).eq("id", id);
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
    } else if (current?.fulfillment === "pickup" && status === "completed") {
      toast.success("Order collected");
    } else {
      toast.success(`Marked ${STATUS_META[nextStatus].label}`);
    }
    if (status === "preparing") void sendOrderEventEmail(id, "preparing");
    if (status === "ready") void sendOrderEventEmail(id, "ready");
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
      .update({ verified_at: new Date().toISOString(), verified_by: u.user?.id, status: "completed", workflow_status: "delivered" } as never)
      .eq("id", order.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (order.fulfillment === "delivery") {
      await supabase.from("deliveries").update({ status: "delivered" } as never).eq("order_id", order.id);
    }
    toast.success(order.fulfillment === "pickup" ? `Order ${order.order_number} collected` : `Order ${order.order_number} delivered`);
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

  async function toggleOnlineOrdering() {
    if (shopToggleBusy) return;
    setShopToggleBusy(true);
    const next = !onlineOrderingOpen;
    const { error } = await (supabase.from("site_settings") as any).update({ online_ordering_open: next }).eq("id", "main");
    setShopToggleBusy(false);
    if (error) return toast.error(error.message);
    setOnlineOrderingOpen(next);
    toast.success(next ? "Online shop opened" : "Online shop closed — checkout is now disabled");
    void logAdminAction({ action_type: "online_shop_toggled", action_description: next ? "Opened online ordering" : "Closed online ordering", target_type: "site_settings", target_id: "main", metadata: { online_ordering_open: next } });
  }

  async function togglePickup() {
    const { error } = await (supabase.from("delivery_settings") as any).update({ pickup_enabled: !pickupEnabled }).eq("id", "default");
    if (error) return toast.error(error.message);
    setPickupEnabled(!pickupEnabled);
    toast.success(!pickupEnabled ? "Pickup enabled" : "Pickup disabled");
  }

  async function reviewReport(reportId: string, driverAction?: "suspend" | "expel") {
    const resolution = window.prompt(driverAction ? `Reason to ${driverAction} this driver:` : "Resolution note:");
    if (resolution === null) return;
    const { error } = await (supabase.rpc as any)("review_driver_report", { _report_id: reportId, _status: "resolved", _resolution: resolution, _driver_action: driverAction ?? null });
    if (error) return toast.error(error.message);
    toast.success(driverAction ? `Driver ${driverAction === "suspend" ? "suspended" : "expelled"}` : "Report resolved");
    void load();
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
    if (o.fulfillment === "delivery" && ["pending_driver_acceptance", "accepted_by_driver", "rejected_by_driver"].includes(o.workflow_status ?? "")) return false;
    const displayStatus = resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]);
    if (branchFilter !== "all" && o.branch_id !== branchFilter) return false;
    if (filter === "all") return true;
    if (filter === "active") return displayStatus !== "completed" && displayStatus !== "cancelled";
    return displayStatus === filter;
  });

  const stats = {
    new: filtered.filter((o) => resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]) === "pending").length,
    prep: filtered.filter((o) => resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]) === "preparing").length,
    ready: filtered.filter((o) => resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]) === "ready").length,
    out: filtered.filter((o) => {
      const displayStatus = resolveOrderDisplayStatus(o.status, deliveryStatuses[o.id]);
      return displayStatus !== null && ["handed_to_driver", "picked_up", "on_the_way", "out_for_delivery"].includes(displayStatus);
    }).length,
  };

  return (
    <div className="min-h-screen pb-10 bg-muted/40">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <Link to="/" className="flex min-w-0 items-center gap-2 font-display text-xl text-brand sm:text-2xl">
            <img src="/images/champs/champs-logo.png" alt="Champs Chicken" className="h-8 w-auto" />
            <span className="truncate">Champs Admin</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            <NotificationCenter />
            <ThemeToggle />
            <button onClick={load} className="hidden h-8 w-8 place-items-center rounded-full border hover:bg-accent sm:grid" aria-label="Refresh orders"><RefreshCw className="h-4 w-4" /></button>
            <button type="button" onClick={() => setMobileNavOpen((value) => !value)} className="grid h-9 w-9 place-items-center rounded-full border md:hidden" aria-label="Open admin menu" aria-expanded={mobileNavOpen}>{mobileNavOpen ? <X className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}</button>
            <button onClick={signOut} className="hidden h-8 w-8 place-items-center rounded-full border hover:bg-accent sm:grid" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        {mobileNavOpen && <div className="border-t bg-background p-3 md:hidden"><nav className="grid grid-cols-2 gap-2">{[
          ["/admin", "Orders", ShieldCheck], ["/admin/menu", "Menu", Utensils], ["/admin/promotions", "Promotions", Sparkles], ["/admin/appearance", "Appearance", Paintbrush], ["/admin/deliveries", "Deliveries", Bike], ["/admin/revenue", "Revenue", TrendingUp], ["/admin/messages", "Messages", MessageCircle], ["/admin/complaints", "Complaints", Flag], ["/admin/audit-trail", "Audit trail", ShieldCheck], ["/admin/security", "Security", LockKeyhole],
        ].map(([to, label, Icon]: any) => <Link key={to} to={to} onClick={() => setMobileNavOpen(false)} className="flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold"><Icon className="h-4 w-4 text-brand" />{label}</Link>)}</nav><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={toggleManualPeak} className="rounded-xl border p-2 text-xs font-bold">Peak {manualPeak ? "on" : "off"}</button><button onClick={togglePickup} className="rounded-xl border p-2 text-xs font-bold">Pickup {pickupEnabled ? "on" : "off"}</button><button onClick={load} className="rounded-xl border p-2 text-xs font-bold">Refresh</button><button onClick={signOut} className="rounded-xl border p-2 text-xs font-bold">Sign out</button></div></div>}
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="min-w-0 lg:flex lg:items-start lg:gap-6">
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
                <Link to="/admin/messages" className={`relative flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}><MessageCircle className="h-4 w-4" /> {!sidebarCollapsed && "Driver Messages"}<UnreadMessageBadge conversationType="driver_admin" /></Link>
                <Link to="/admin/complaints" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}><Flag className="h-4 w-4" /> {!sidebarCollapsed && "Complaints"}<UnreadNavigationBadge types={["complaint_update", "driver_report"]} /></Link>
                <Link to="/admin/security" className={`flex items-center rounded-md py-2 text-sm font-semibold hover:bg-accent ${sidebarCollapsed ? "justify-center px-2" : "gap-2 px-3"}`}><LockKeyhole className="h-4 w-4" /> {!sidebarCollapsed && "Security"}</Link>
              </nav>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
                      {role === "admin" && reports.length > 0 && (
                        <div className="mb-4 rounded-2xl border border-destructive/30 bg-card p-4"><div className="mb-3 inline-flex items-center gap-2 font-display text-lg text-destructive"><Flag className="h-4 w-4" /> Driver reports ({reports.length})</div><div className="space-y-2">{reports.map((report) => <div key={report.id} className="rounded-xl border p-3 text-sm"><div className="font-semibold">{report.reason}</div><div className="mt-1 text-xs text-muted-foreground">{report.details}</div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => reviewReport(report.id)} className="rounded-full border px-3 py-1.5 text-xs font-semibold">Resolve</button><button onClick={() => reviewReport(report.id, "suspend")} className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-bold text-white">Suspend driver</button><button onClick={() => reviewReport(report.id, "expel")} className="rounded-full bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground">Expel driver</button></div></div>)}</div></div>
                      )}
                      {role === "admin" && (
                        <form onSubmit={grantAccess} className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                          <input
                            type="email"
                            value={grantEmail}
                            onChange={(event) => setGrantEmail(event.target.value)}
                            placeholder="staff@example.com"
                            className="min-w-0 rounded-md border px-3 py-2 text-sm"
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

        {role === "admin" && <div className={`mb-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${onlineOrderingOpen ? "border-emerald-500/40 bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/35 dark:text-emerald-100" : "border-amber-500/40 bg-amber-50 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100"}`}>
          <div><div className="text-sm font-bold">Online shop is {onlineOrderingOpen ? "open" : "closed"}</div><div className="text-xs opacity-80">{onlineOrderingOpen ? "Customers can place pickup and delivery orders." : "Checkout is blocked until an administrator reopens it."}</div></div>
          <button type="button" onClick={() => void toggleOnlineOrdering()} disabled={shopToggleBusy} className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-60 ${onlineOrderingOpen ? "bg-foreground text-background" : "bg-emerald-600 text-white"}`}>{shopToggleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}{onlineOrderingOpen ? "Close online shop" : "Open online shop"}</button>
        </div>}

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
          <Stat label="Ready" value={stats.ready} tone="bg-emerald-500" />
          <Stat label="Out for delivery" value={stats.out} tone="bg-purple-500" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {([
            { value: "active", label: "Active" },
            { value: "preparing", label: "Preparing" },
            { value: "ready", label: "Ready" },
            { value: "handed_to_driver", label: "Handed to driver" },
            { value: "out_for_delivery", label: "Out for delivery" },
            { value: "completed", label: "Completed" },
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
                onPrint={(id) => void printOrderReceipt(id).catch((error) => toast.error(error.message))}
              />
            );
          })}
        </div>
          </main>
        </div>
      </div>
      {duePromptOrder && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-3xl bg-background p-5 shadow-2xl"><div className="text-xs font-bold uppercase tracking-wider text-brand">Preparation timer reached</div><h2 className="mt-1 font-display text-2xl">Is {duePromptOrder.order_number} ready?</h2><p className="mt-2 text-sm text-muted-foreground">The configured base preparation time has elapsed. Confirm now or dismiss and keep preparing.</p><div className="mt-5 flex gap-2"><button onClick={() => setDuePromptOrder(null)} className="flex-1 rounded-full border px-4 py-2 text-sm font-bold">Keep preparing</button><button onClick={() => { void updateStatus(duePromptOrder.id, "ready"); setDuePromptOrder(null); }} className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground">Mark ready</button></div></div></div>}
    </div>
  );
}

function OrderCard({
  order: o, items, branchName, branchPhone, deliveryStatus, deliveryDriverId, driverName, onUpdateStatus, onVerify, onPrint,
}: {
  order: Order; items: ItemRow[]; branchName: string; branchPhone: string | null; deliveryStatus?: string | null; deliveryDriverId?: string | null; driverName?: string;
  onUpdateStatus: (id: string, s: Order["status"]) => Promise<void>;
  onVerify: (o: Order, pin: string) => void;
  onPrint: (id: string) => void;
}) {
  const effectiveStatus = resolveOrderDisplayStatus(o.status, deliveryStatus) ?? o.status;
  const meta = STATUS_META[effectiveStatus];
  const StatusIcon = meta.icon;
  const statusFlow = o.fulfillment === "pickup" ? PICKUP_STATUS_FLOW : DELIVERY_STATUS_FLOW;
  const currentIdx = statusFlow.indexOf(effectiveStatus as Order["status"]);
  const next = currentIdx >= 0 && currentIdx < statusFlow.length - 1 ? statusFlow[currentIdx + 1] : null;
  const statusLabel = o.fulfillment === "pickup" && effectiveStatus === "completed" ? "Collected" : meta.label;
  const nextLabel = o.fulfillment === "pickup" && next === "completed" ? "Collected" : next ? STATUS_META[next].label : null;
  const shouldShowNext = !(o.fulfillment === "delivery" && (effectiveStatus === "completed" || effectiveStatus === "cancelled"));
  const [pinInput, setPinInput] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  async function changeStatus(status: Order["status"]) {
    if (statusBusy) return;
    setStatusBusy(status);
    try { await onUpdateStatus(o.id, status); } finally { setStatusBusy(null); }
  }

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
            <StatusIcon className="h-3 w-3" /> {statusLabel}
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
        <div className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${o.fulfillment === "delivery" ? "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-200" : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"}`}>
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
          <button onClick={() => onPrint(o.id)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-bold"><Printer className="h-3 w-3" /> Print</button>
          {o.driver_id && <ChatDialog audience="champs" orderId={o.id} driverId={o.driver_id} label="Driver chat" className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-bold" />}
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-2.5 py-1.5 text-[11px] font-bold text-white hover:opacity-90">
            <MessageCircle className="h-3 w-3" /> WA
          </a>
          {effectiveStatus !== "cancelled" && effectiveStatus !== "completed" && (
            <button disabled={!!statusBusy} onClick={() => void changeStatus("cancelled")} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-brand disabled:opacity-60">
              {statusBusy === "cancelled" && <Loader2 className="h-3 w-3 animate-spin" />}Cancel
            </button>
          )}
          {next && shouldShowNext && (
            <button
              onClick={() => void changeStatus(next)}
              disabled={!!statusBusy || (next === "handed_to_driver" && !deliveryDriverId)}
              title={next === "handed_to_driver" && !deliveryDriverId ? "Assign a driver before handing to driver" : undefined}
              className={
                "rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-brand-foreground hover:bg-brand-dark " +
                (next === "handed_to_driver" && !deliveryDriverId ? "opacity-50 cursor-not-allowed" : "")
              }
            >
              {statusBusy === next ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Saving…</span> : <>→ {nextLabel}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, to }: { label: string; value: React.ReactNode; tone: string; to?: "/admin/revenue" }) {
  const content = (
    <div className={`rounded-2xl border bg-card p-3 ${to ? "transition-colors hover:bg-accent" : ""}`}>
      <div className={"inline-block h-2 w-6 rounded-full " + tone} />
      <div className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-2xl">{value}</div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}
