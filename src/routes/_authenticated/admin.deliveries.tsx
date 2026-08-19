import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bike, Plus, Trash2, Loader2, Phone, Zap, MoreVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { adminUpsertDriverByEmail, approveDriverApplication, rejectDriverApplication, listDriversForAdmin } from "@/lib/admin.functions";
import {
  DELIVERY_STATUS_LABEL,
  DEFAULT_DELIVERY_SETTINGS,
  fetchDeliverySettings,
  distanceKm,
  computeMode,
  capacityForMode,
  computeEtaRange,
  type DeliverySettings,
} from "@/lib/delivery";
import { logAdminAction } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/admin/deliveries")({
  head: () => ({ meta: [{ title: "Deliveries — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: DeliveriesPage,
});

type Driver = { id: string; user_id: string | null; name: string; phone: string; status: string; approval_status?: string | null; branch_id: string | null; bank_name?: string | null; bank_account_number?: string | null; bank_account_holder?: string | null };
type Delivery = {
  id: string;
  order_id: string;
  driver_id: string | null;
  status: string;
  distance_km: number | null;
  delivery_fee_cents: number;
  created_at: string;
  batch_id: string | null;
  queue_position: number | null;
  estimated_eta_min: number | null;
  estimated_eta_max: number | null;
};
type Order = { id: string; order_number: string; customer_name: string; customer_phone: string; delivery_address: string | null; delivery_lat: number | null; delivery_lng: number | null; subtotal_cents: number; branch_id: string };
type Branch = { id: string; name: string; city: string };
type DriverApplication = { id: string; user_id: string; name: string; phone: string; branch_id: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_holder: string | null; status: string; created_at: string; admin_notes: string | null };

function DeliveriesPage() {
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [applications, setApplications] = useState<DriverApplication[]>([]);
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [batching, setBatching] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // new driver form
  const [nd, setNd] = useState({ name: "", phone: "", email: "", branch_id: "", bank_name: "", bank_account_number: "", bank_account_holder: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    console.info("admin deliveries load start");
    const [directoryResult, { data: dels }, { data: bs }, s] = await Promise.all([
      listDriversForAdmin({ data: {} }).catch((err) => {
        console.error("listDriversForAdmin failed", err);
        toast.error("Could not load driver directory");
        return { ok: false, drivers: [], applications: [] };
      }),
      supabase.from("deliveries").select("id, order_id, driver_id, status, distance_km, delivery_fee_cents, created_at, batch_id, queue_position, estimated_eta_min, estimated_eta_max").order("created_at", { ascending: false }).limit(100),
      supabase.from("branches").select("id, name, city").eq("is_active", true).order("sort_order"),
      fetchDeliverySettings().catch(() => DEFAULT_DELIVERY_SETTINGS),
    ]);
    console.info("admin deliveries directory result", directoryResult);
    const adminDirectory = (directoryResult as any)?.data ?? directoryResult;
    const driverRows = ((adminDirectory as any)?.drivers ?? []) as Driver[];
    console.info("admin deliveries directory driverRows length", driverRows.length);
    setDrivers(driverRows);
    setApplications(((adminDirectory as any)?.applications ?? []) as DriverApplication[]);
    const dl = (dels ?? []) as Delivery[];
    setDeliveries(dl);
    setSettings(s);
    const bm: Record<string, Branch> = {};
    for (const b of (bs ?? []) as Branch[]) bm[b.id] = b;
    setBranches(bm);
    const ids = dl.map((d) => d.order_id);
    if (ids.length) {
      const { data: os } = await supabase.from("orders").select("id, order_number, customer_name, customer_phone, delivery_address, delivery_lat, delivery_lng, subtotal_cents, branch_id").in("id", ids);
      const om: Record<string, Order> = {};
      for (const o of (os ?? []) as Order[]) om[o.id] = o;
      setOrders(om);
    } else setOrders({});
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function autoBatch() {
    setBatching(true);
    try {
      const pending = deliveries.filter((d) => d.driver_id === null && d.status !== "delivered");
      if (pending.length === 0) { toast.message("No unassigned deliveries"); return; }
      const activeDrivers = drivers.filter((d) => d.approval_status === "approved" && d.status === "active");
      if (activeDrivers.length === 0) { toast.error("No active drivers online right now"); return; }

      const activeCount = deliveries.filter((d) => d.status !== "delivered").length;
      const mode = computeMode(activeCount, settings);
      const cap = capacityForMode(mode, settings);

      // Group pending by proximity: greedy — pick a seed, cluster within 1km
      const remaining = [...pending];
      const clusters: Delivery[][] = [];
      while (remaining.length) {
        const seed = remaining.shift()!;
        const so = orders[seed.order_id];
        const group = [seed];
        if (so?.delivery_lat && so?.delivery_lng) {
          for (let i = remaining.length - 1; i >= 0; i--) {
            if (group.length >= cap.max) break;
            const co = orders[remaining[i].order_id];
            if (co?.delivery_lat && co?.delivery_lng) {
              const km = distanceKm({ lat: so.delivery_lat, lng: so.delivery_lng }, { lat: co.delivery_lat, lng: co.delivery_lng });
              if (km <= 1.0) { group.push(remaining.splice(i, 1)[0]); }
            }
          }
        }
        clusters.push(group);
      }

      // Round-robin cluster -> driver
      const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
      const perDriverCount: Record<string, number> = Object.fromEntries(activeDrivers.map((d) => [d.id, 0]));
      let di = 0;
      for (const cluster of clusters) {
        const driver = activeDrivers[di % activeDrivers.length]; di++;
        // Insert a batch row
        const { data: batch, error: bErr } = await supabase.from("delivery_batches").insert({ driver_id: driver.id, status: "pending" } as never).select("id").single();
        if (bErr) throw bErr;
        for (const d of cluster) {
          perDriverCount[driver.id] = (perDriverCount[driver.id] ?? 0) + 1;
          const pos = perDriverCount[driver.id];
          const eta = computeEtaRange(pos, settings, mode);
          updates.push({
            id: d.id,
            patch: { driver_id: driver.id, status: "accepted", batch_id: batch.id, queue_position: pos, estimated_eta_min: eta.min, estimated_eta_max: eta.max },
          });
        }
      }
      for (const u of updates) {
        const { error } = await supabase.from("deliveries").update(u.patch as never).eq("id", u.id);
        if (error) throw error;
      }
      toast.success(`Auto-batched ${pending.length} deliveries into ${clusters.length} routes (${mode} mode)`);
      void logAdminAction({ action_type: "deliveries_auto_batched", action_description: `Auto-batched ${pending.length} deliveries`, target_type: "delivery_batch", metadata: { delivery_count: pending.length, batch_count: clusters.length, mode } });
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Auto-batch failed");
    } finally {
      setBatching(false);
    }
  }

  async function createDriver() {
    if (!nd.name.trim() || !nd.phone.trim() || !nd.email.trim()) return toast.error("Name, phone and login email are required");
    setCreating(true);
    try {
      await adminUpsertDriverByEmail({ data: { email: nd.email.trim(), name: nd.name.trim(), phone: nd.phone.trim(), branchId: nd.branch_id || undefined, bankName: nd.bank_name, bankAccountNumber: nd.bank_account_number, bankAccountHolder: nd.bank_account_holder } });
      toast.success("Driver added and access granted");
      void logAdminAction({ action_type: "driver_created", action_description: `Created driver ${nd.name.trim()}`, target_type: "driver", metadata: { email: nd.email.trim(), branch_id: nd.branch_id || null } });
      setNd({ name: "", phone: "", email: "", branch_id: "", bank_name: "", bank_account_number: "", bank_account_holder: "" });
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Could not add driver");
    } finally {
      setCreating(false);
    }
  }

  async function approveApplication(app: DriverApplication) {
    try {
      await approveDriverApplication({ data: { applicationId: app.id } });
      toast.success(`${app.name} approved as driver`);
      void logAdminAction({ action_type: "driver_approved", action_description: `Approved driver ${app.name}`, target_type: "driver_application", target_id: app.id, metadata: { name: app.name } });
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Could not approve driver request");
    }
  }

  async function rejectApplication(app: DriverApplication) {
    try {
      await rejectDriverApplication({ data: { applicationId: app.id } });
      toast.success("Driver request rejected");
      void logAdminAction({ action_type: "driver_rejected", action_description: `Rejected driver ${app.name}`, target_type: "driver_application", target_id: app.id, metadata: { name: app.name } });
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Could not reject driver request");
    }
  }

  async function removeDriver(id: string) {
    if (!confirm("Remove this driver?")) return;
    const { error } = await supabase.from("drivers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void logAdminAction({ action_type: "driver_deleted", action_description: "Deleted driver profile", target_type: "driver", target_id: id });
    load();
  }

  async function deleteApplication(app: DriverApplication) {
    if (!confirm(`Delete ${app.name}'s driver request?`)) return;
    const { error } = await supabase.from("driver_applications").delete().eq("id", app.id);
    if (error) return toast.error(error.message);
    toast.success("Driver request deleted");
    load();
  }

  async function assignDriver(deliveryId: string, driverId: string | null) {
    const delivery = deliveries.find((entry) => entry.id === deliveryId);
    const previousDriverId = delivery?.driver_id ?? null;
    const patch: any = { driver_id: driverId };
    if (driverId) patch.status = "accepted";
    const { error } = await supabase.from("deliveries").update(patch).eq("id", deliveryId);
    if (error) return toast.error(error.message);

    if (delivery?.order_id) {
      const orderPatch: Record<string, unknown> = { driver_id: driverId };
      if (driverId && previousDriverId && previousDriverId !== driverId) orderPatch.status = "ready";
      const { error: orderError } = await supabase.from("orders").update(orderPatch).eq("id", delivery.order_id);
      if (orderError) {
        toast.error(orderError.message);
        return;
      }
      void logAdminAction({ action_type: "driver_assigned", action_description: `Assigned order ${delivery.order_id} to a driver`, target_type: "order", target_id: delivery.order_id, metadata: { before_driver_id: previousDriverId, after_driver_id: driverId, before_status: delivery.status, after_status: driverId && previousDriverId && previousDriverId !== driverId ? "ready" : delivery.status } });
    }

    toast.success("Assignment updated");
    load();
  }

  async function saveDeliveryOptions() {
    setSettingsSaving(true);
    const { error } = await supabase.from("delivery_settings").update({ delivery_enabled: settings.delivery_enabled, drivers_dial_up_only: settings.drivers_dial_up_only } as never).eq("id", "default");
    setSettingsSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Delivery options saved");
    void logAdminAction({ action_type: "delivery_settings_updated", action_description: "Updated delivery options", target_type: "delivery_settings", target_id: "default", metadata: { delivery_enabled: settings.delivery_enabled, drivers_dial_up_only: settings.drivers_dial_up_only } });
  }

  const activeDeliveries = useMemo(() => deliveries.filter((d) => d.status !== "delivered" && d.status !== "cancelled"), [deliveries]);
  const completed = useMemo(() => deliveries.filter((d) => d.status === "delivered" || d.status === "cancelled"), [deliveries]);

  if (loading) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>;

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Admin</Link>
          <div className="font-display text-xl text-brand inline-flex items-center gap-2"><Bike className="h-5 w-5" /> Deliveries</div>
          <Link to="/admin/delivery-settings" className="text-xs font-semibold text-brand underline">Settings</Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-4 space-y-6">
        <section className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-display text-lg text-brand">Delivery options</h2><p className="text-xs text-muted-foreground">Control how customers and drivers use delivery.</p></div>
            <button onClick={saveDeliveryOptions} disabled={settingsSaving} className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-60">{settingsSaving ? "Saving..." : "Save"}</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={settings.delivery_enabled} onChange={(e) => setSettings({ ...settings, delivery_enabled: e.target.checked })} /> <span><span className="font-semibold">Delivery enabled</span><span className="block text-xs text-muted-foreground">Allow customers to choose delivery.</span></span></label>
            <label className="flex items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={settings.drivers_dial_up_only} onChange={(e) => setSettings({ ...settings, drivers_dial_up_only: e.target.checked })} /> <span><span className="font-semibold">Drivers dial up only</span><span className="block text-xs text-muted-foreground">Customers can order pickup; drivers handle delivery orders.</span></span></label>
          </div>
        </section>
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-display text-lg text-brand mb-3">Drivers</h2>
          <div className="grid gap-2 md:grid-cols-5">
            <input placeholder="Name" value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            <input placeholder="Phone" value={nd.phone} onChange={(e) => setNd({ ...nd, phone: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            <input placeholder="Login email (optional)" value={nd.email} onChange={(e) => setNd({ ...nd, email: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            <select value={nd.branch_id} onChange={(e) => setNd({ ...nd, branch_id: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
              <option value="">Any branch</option>
              {Object.values(branches).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button onClick={createDriver} disabled={creating} className="rounded-xl bg-brand px-3 py-2 text-sm font-bold text-brand-foreground inline-flex items-center justify-center gap-1 disabled:opacity-60">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </button>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input placeholder="Bank" value={nd.bank_name} onChange={(e) => setNd({ ...nd, bank_name: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            <input placeholder="Account number" value={nd.bank_account_number} onChange={(e) => setNd({ ...nd, bank_account_number: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            <input placeholder="Account holder" value={nd.bank_account_holder} onChange={(e) => setNd({ ...nd, bank_account_holder: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Enter the driver's login email to create/update their driver profile and grant driver dashboard access.</p>

          {applications.filter((app) => app.status === "pending").length > 0 && (
            <div className="mt-4 rounded-xl border border-dashed p-3">
              <h3 className="text-sm font-bold text-brand">Driver requests</h3>
              <div className="mt-2 divide-y">
                {applications.filter((app) => app.status === "pending").map((app) => (
                  <div key={app.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{app.name}</div>
                      <div className="text-xs text-muted-foreground">{app.phone}{app.branch_id && branches[app.branch_id] ? ` · ${branches[app.branch_id].name}` : ""}</div>
                    </div>
                    <button onClick={() => approveApplication(app)} className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground">Approve</button>
                    <button onClick={() => rejectApplication(app)} className="rounded-full border px-3 py-1.5 text-xs font-semibold text-muted-foreground">Reject</button>
                    <button onClick={() => deleteApplication(app)} className="rounded-full border border-destructive/50 px-3 py-1.5 text-xs font-semibold text-destructive">Delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 divide-y">
            {drivers.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No drivers yet.</div>}
            {drivers.map((d) => (
              <div key={d.id} className="space-y-2 rounded-2xl border border-muted/30 p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">{d.name}</div>
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {d.phone}{d.branch_id && branches[d.branch_id] ? ` · ${branches[d.branch_id].name}` : ""}</div>
                  </div>
                  <select value={d.branch_id ?? ""} onChange={async (e) => {
                    const { error } = await supabase.from("drivers").update({ branch_id: e.target.value || null } as never).eq("id", d.id);
                    if (error) toast.error(error.message);
                    else {
                      setDrivers((prev) => prev.map((item) => item.id === d.id ? { ...item, branch_id: e.target.value || null } : item));
                      toast.success("Driver branch updated");
                      void logAdminAction({ action_type: "driver_profile_updated", action_description: `Updated branch for driver ${d.name}`, target_type: "driver", target_id: d.id, metadata: { before_branch_id: d.branch_id, after_branch_id: e.target.value || null } });
                    }
                  }} className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
                    <option value="">No branch</option>
                    {Object.values(branches).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " + (d.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>{d.approval_status ?? d.status}</span>
                  <button onClick={() => setExpandedDriverId((prev) => (prev === d.id ? null : d.id))} className="grid h-8 w-8 place-items-center rounded-full border text-muted-foreground hover:bg-muted">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
                {expandedDriverId === d.id && (
                  <div className="rounded-2xl bg-muted/50 p-3 text-sm text-muted-foreground">
                    {d.bank_name ? <div><span className="font-semibold text-foreground">Bank:</span> {d.bank_name}</div> : null}
                    {d.bank_account_number ? <div><span className="font-semibold text-foreground">Account:</span> {d.bank_account_number}</div> : null}
                    {d.bank_account_holder ? <div><span className="font-semibold text-foreground">Holder:</span> {d.bank_account_holder}</div> : null}
                    {!d.bank_name && !d.bank_account_number && !d.bank_account_holder && <div>No banking details provided.</div>}
                    <button onClick={() => removeDriver(d.id)} className="mt-3 rounded-full border border-destructive/50 px-3 py-1.5 text-xs font-semibold text-destructive">Delete driver</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg text-brand">Active deliveries ({activeDeliveries.length})</h2>
            <button
              onClick={autoBatch}
              disabled={batching}
              className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground inline-flex items-center gap-1 disabled:opacity-60"
            >
              {batching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Auto-batch & assign
            </button>
          </div>
          <div className="space-y-2">
            {activeDeliveries.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No active deliveries.</div>}
            {activeDeliveries.map((d) => {
              const o = orders[d.order_id];
              const b = o ? branches[o.branch_id] : null;
              return (
                <div key={d.id} className="rounded-xl border p-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      {d.queue_position != null && <span className="rounded-full bg-brand text-brand-foreground text-[10px] font-bold px-2 py-0.5">#{d.queue_position}</span>}
                      #{o?.order_number} · {o?.customer_name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{o?.delivery_address ?? "—"} · {b?.name ?? ""}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.distance_km ? `${Number(d.distance_km).toFixed(1)} km · ` : ""}Fee {formatZAR(d.delivery_fee_cents)} · Order {formatZAR(o?.subtotal_cents ?? 0)}
                      {d.estimated_eta_min != null && d.estimated_eta_max != null && ` · ETA ${d.estimated_eta_min}–${d.estimated_eta_max}min`}
                    </div>
                  </div>
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase text-brand">{DELIVERY_STATUS_LABEL[d.status] ?? d.status}</span>
                  <select value={d.driver_id ?? ""} onChange={(e) => assignDriver(d.id, e.target.value || null)} className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {drivers.map((dr) => <option key={dr.id} value={dr.id}>{dr.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </section>

        {completed.length > 0 && (
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-display text-lg text-brand mb-3">Recently delivered</h2>
            <ul className="text-sm space-y-1">
              {completed.slice(0, 20).map((d) => {
                const o = orders[d.order_id];
                const dr = drivers.find((x) => x.id === d.driver_id);
                const isCancelled = d.status === "cancelled";
                return (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>#{o?.order_number} · {o?.customer_name}</span>
                    <div className="flex items-center gap-2">
                      {isCancelled ? (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase text-destructive">Cancelled</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Delivered</span>
                      )}
                      <span>{dr?.name ?? "—"} · {formatZAR(d.delivery_fee_cents)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
