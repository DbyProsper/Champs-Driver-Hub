import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bike, CalendarDays, Download, Package, Printer, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/revenue")({
  head: () => ({ meta: [{ title: "Revenue Overview — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: RevenueOverviewPage,
});

type Order = {
  id: string;
  order_number: string;
  subtotal_cents: number;
  fulfillment: "pickup" | "delivery";
  created_at: string;
  branch_id: string;
  status: "pending" | "preparing" | "ready" | "handed_to_driver" | "picked_up" | "on_the_way" | "out_for_delivery" | "completed" | "cancelled";
  workflow_status: string;
};

type Branch = { id: string; city: string };

type RevenueRange = "day" | "week" | "month" | "year" | "lifetime" | "custom";

type RevenueRangeSelection = { type: RevenueRange; customFrom?: string; customTo?: string };

const REVENUE_RANGES: { value: RevenueRange; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
  { value: "lifetime", label: "Lifetime" },
  { value: "custom", label: "Custom" },
];

function matchesRevenueRange(createdAt: string, selection: RevenueRangeSelection) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  if (selection.type === "lifetime") return true;
  if (selection.type === "custom") {
    const from = selection.customFrom ? new Date(`${selection.customFrom}T00:00:00`) : null;
    const to = selection.customTo ? new Date(`${selection.customTo}T23:59:59.999`) : null;
    if (from && Number.isNaN(from.getTime())) return false;
    if (to && Number.isNaN(to.getTime())) return false;
    return (!from || created >= from) && (!to || created <= to);
  }

  const now = new Date();
  const start = new Date(now);
  if (selection.type === "day") {
    start.setHours(0, 0, 0, 0);
    return created >= start;
  }
  if (selection.type === "week") start.setDate(now.getDate() - 7);
  if (selection.type === "month") start.setMonth(now.getMonth() - 1);
  if (selection.type === "year") start.setFullYear(now.getFullYear() - 1);

  return created >= start;
}

function RevenueOverviewPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [range, setRange] = useState<RevenueRange>("day");
  const today = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState<string>(today);
  const [customTo, setCustomTo] = useState<string>(today);

  useEffect(() => {
    let active = true;
    (async () => {
      const [ordersRes, branchesRes] = await Promise.all([
        supabase.from("orders").select("id, order_number, subtotal_cents, fulfillment, created_at, branch_id, status, workflow_status").order("created_at", { ascending: false }),
        supabase.from("branches").select("id, city").eq("is_active", true).order("sort_order"),
      ]);
      if (!active) return;
      setOrders((ordersRes.data as Order[]) ?? []);
      setBranches((branchesRes.data as Branch[]) ?? []);
    })();
    return () => { active = false; };
  }, []);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    if (branchFilter !== "all" && order.branch_id !== branchFilter) return false;
    return matchesRevenueRange(order.created_at, { type: range, customFrom, customTo });
  }), [branchFilter, orders, range, customFrom, customTo]);

  const collectedOrders = filteredOrders.filter((order) => order.fulfillment === "pickup"
    ? order.status === "completed"
    : ["handed_to_driver", "picked_up", "on_the_way", "out_for_delivery", "completed"].includes(order.status)
      || ["picked_up", "out_for_delivery", "delivered"].includes(order.workflow_status));
  const revenue = collectedOrders.reduce((sum, order) => sum + order.subtotal_cents, 0);
  const deliveryRevenue = collectedOrders.filter((order) => order.fulfillment === "delivery").reduce((sum, order) => sum + order.subtotal_cents, 0);
  const pickupRevenue = collectedOrders.filter((order) => order.fulfillment === "pickup").reduce((sum, order) => sum + order.subtotal_cents, 0);
  const deliveryCount = collectedOrders.filter((order) => order.fulfillment === "delivery").length;
  const pickupCount = collectedOrders.length - deliveryCount;
  const selectedBranchLabel = branchFilter === "all" ? "All branches" : branches.find((branch) => branch.id === branchFilter)?.city ?? "Selected branch";
  const branchLookup = new Map(branches.map((branch) => [branch.id, branch.city]));
  const selectedRangeLabel = range === "custom"
    ? `${customFrom || "Beginning"} to ${customTo || "Today"}`
    : REVENUE_RANGES.find((item) => item.value === range)?.label ?? "Selected period";

  function downloadRevenueCsv() {
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ["Order", "Date", "Branch", "Type", "Status", "Revenue (R)"],
      ...collectedOrders.map((order) => [
        order.order_number,
        new Date(order.created_at).toLocaleString(),
        branchLookup.get(order.branch_id) ?? "Branch",
        order.fulfillment,
        order.status.replace(/_/g, " "),
        (order.subtotal_cents / 100).toFixed(2),
      ]),
      [],
      ["Report", selectedBranchLabel, selectedRangeLabel, "Total revenue", (revenue / 100).toFixed(2)],
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `champs-revenue-${selectedBranchLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Orders</Link>
          <div className="font-display text-xl text-brand inline-flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> Revenue Overview</div>
          <div className="text-xs text-muted-foreground">{selectedBranchLabel}</div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4 space-y-4">
        <section className="rounded-3xl border bg-card p-4 shadow-sm print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Revenue filters
              </div>
              <div className="mt-1 font-display text-xl text-brand">{selectedBranchLabel}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setBranchFilter("all")} className={"rounded-full px-3 py-1.5 text-xs font-semibold " + (branchFilter === "all" ? "bg-brand text-brand-foreground" : "border bg-background text-muted-foreground")}>All branches</button>
              {branches.map((branch) => (
                <button key={branch.id} type="button" onClick={() => setBranchFilter(branch.id)} className={"rounded-full px-3 py-1.5 text-xs font-semibold " + (branchFilter === branch.id ? "bg-brand text-brand-foreground" : "border bg-background text-muted-foreground")}>{branch.city}</button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {REVENUE_RANGES.map((item) => (
              <button key={item.value} type="button" onClick={() => setRange(item.value)} className={"rounded-full px-3 py-1.5 text-xs font-semibold " + (range === item.value ? "bg-brand text-brand-foreground" : "border bg-background text-muted-foreground")}>{item.label}</button>
            ))}
            {range === "custom" && (
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"><span>From</span><input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-full border bg-background px-2 py-1 text-xs" /></label>
                <label className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"><span>To</span><input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} className="rounded-full border bg-background px-2 py-1 text-xs" /></label>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4 print:hidden">
            <div className="text-xs text-muted-foreground">Exporting {collectedOrders.length} revenue orders · {selectedRangeLabel}</div>
            <div className="flex gap-2">
              <button type="button" onClick={downloadRevenueCsv} className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs font-bold hover:border-brand"><Download className="h-3.5 w-3.5" /> Download CSV</button>
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-2 text-xs font-bold text-brand-foreground"><Printer className="h-3.5 w-3.5" /> Print report</button>
            </div>
          </div>
        </section>

        <section className="hidden print:block">
          <div className="font-display text-3xl">Champs revenue report</div>
          <div className="mt-1 text-sm">{selectedBranchLabel} · {selectedRangeLabel}</div>
          <table className="mt-5 w-full border-collapse text-left text-xs">
            <thead><tr className="border-b"><th className="py-2">Order</th><th>Date</th><th>Branch</th><th>Type</th><th className="text-right">Revenue</th></tr></thead>
            <tbody>{collectedOrders.map((order) => <tr key={order.id} className="border-b"><td className="py-2">#{order.order_number}</td><td>{new Date(order.created_at).toLocaleDateString()}</td><td>{branchLookup.get(order.branch_id) ?? "Branch"}</td><td className="capitalize">{order.fulfillment}</td><td className="text-right">{formatZAR(order.subtotal_cents)}</td></tr>)}</tbody>
            <tfoot><tr className="font-bold"><td colSpan={4} className="py-3">Total revenue</td><td className="text-right">{formatZAR(revenue)}</td></tr></tfoot>
          </table>
        </section>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Sales revenue
            </div>
            <div className="mt-2 font-display text-3xl text-brand">{formatZAR(revenue)}</div>
            <div className="mt-1 text-sm text-muted-foreground">{collectedOrders.length} collected orders in this view</div>
          </div>
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <Bike className="h-3.5 w-3.5" /> Delivery revenue
            </div>
            <div className="mt-2 font-display text-3xl text-brand">{formatZAR(deliveryRevenue)}</div>
            <div className="mt-1 text-sm text-muted-foreground">{deliveryCount} delivery orders</div>
          </div>
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <Package className="h-3.5 w-3.5" /> Pickup revenue
            </div>
            <div className="mt-2 font-display text-3xl text-brand">{formatZAR(pickupRevenue)}</div>
            <div className="mt-1 text-sm text-muted-foreground">{pickupCount} pickup orders</div>
          </div>
        </div>

        <section className="rounded-3xl border bg-card p-4 shadow-sm print:hidden">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">All orders</div>
              <div className="font-display text-xl text-brand">Compact view</div>
            </div>
            <div className="text-xs text-muted-foreground">{filteredOrders.length} orders</div>
          </div>
          <div className="overflow-hidden rounded-2xl border">
            <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr_0.7fr] gap-2 bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <div>Order</div>
              <div>Branch</div>
              <div>Type</div>
              <div>Status</div>
              <div className="text-right">Amount</div>
            </div>
            {filteredOrders.map((order) => (
              <Link key={order.id} to="/order/$number" params={{ number: order.order_number }} className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr_0.7fr] gap-2 border-t bg-background px-3 py-2 text-sm hover:bg-muted/50">
                <div className="min-w-0">
                  <div className="truncate font-semibold">#{order.order_number}</div>
                  <div className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</div>
                </div>
                <div className="truncate text-muted-foreground">{branchLookup.get(order.branch_id) ?? "Branch"}</div>
                <div className="capitalize text-muted-foreground">{order.fulfillment}</div>
                <div className={order.status === "cancelled" ? "text-destructive" : "text-foreground"}>{order.status.replace(/_/g, " ")}</div>
                <div className="text-right font-semibold">{formatZAR(order.subtotal_cents)}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
