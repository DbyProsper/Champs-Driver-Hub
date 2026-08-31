import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bike, Plus, Loader2, Phone, Zap, X, ExternalLink } from "lucide-react";
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
import { SA_BANKS } from "@/lib/sa-banks";
import { ImagePreview } from "@/components/ImagePreview";

export const Route = createFileRoute("/_authenticated/admin/deliveries")({
  head: () => ({ meta: [{ title: "Deliveries — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: DeliveriesPage,
});

type Driver = { id: string; user_id: string | null; name: string; phone: string; status: string; profile_image_url?: string | null; rating?: number; rating_count?: number; approval_status?: string | null; suspended_until?: string | null; suspension_reason?: string | null; branch_id: string | null; bank_name?: string | null; bank_account_number?: string | null; bank_account_holder?: string | null };
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
type DriverApplication = { id: string; user_id: string; name: string; phone: string; branch_id: string | null; id_number: string | null; student_number: string | null; profile_photo_url: string | null; selfie_url: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_holder: string | null; status: string; created_at: string; admin_notes: string | null };
type DriverReview = { id: string; rating: number; comment: string | null; created_at: string; order_number: string };

function DeliveriesPage() {
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [applications, setApplications] = useState<DriverApplication[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [selectedReviews, setSelectedReviews] = useState<DriverReview[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [batching, setBatching] = useState(false);

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

  async function suspendDriver(driver: Driver) {
    const reason = window.prompt(`Reason for suspending ${driver.name} for 24 hours:`);
    if (reason === null) return;
    if (!reason.trim()) return toast.error("Enter a suspension reason");
    const { data, error } = await (supabase.rpc as any)("suspend_driver_24h", { _driver_id: driver.id, _reason: reason.trim() });
    if (error) return toast.error(error.message);
    toast.success(`${driver.name} suspended for 24 hours`);
    void logAdminAction({ action_type: "driver_suspended", action_description: `Suspended ${driver.name} for 24 hours`, target_type: "driver", target_id: driver.id, metadata: { reason: reason.trim(), suspended_until: data } });
    load();
  }

  async function openDriver(driver: Driver) {
    setSelectedDriver(driver);
    setProfileLoading(true);
    const { data } = await (supabase.rpc as any)("get_driver_reviews", { _driver_id: driver.id });
    setSelectedReviews((data ?? []) as DriverReview[]);
    setProfileLoading(false);
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
      const { error: orderError } = await supabase.from("orders").update(orderPatch as never).eq("id", delivery.order_id);
      if (orderError) {
        toast.error(orderError.message);
        return;
      }
      void logAdminAction({ action_type: "driver_assigned", action_description: `Assigned order ${delivery.order_id} to a driver`, target_type: "order", target_id: delivery.order_id, metadata: { before_driver_id: previousDriverId, after_driver_id: driverId, before_status: delivery.status, after_status: driverId && previousDriverId && previousDriverId !== driverId ? "ready" : delivery.status } });
    }

    toast.success("Assignment updated");
    load();
  }

  const activeDeliveries = useMemo(() => deliveries.filter((d) => d.status !== "delivered" && d.status !== "cancelled"), [deliveries]);
  const completed = useMemo(() => deliveries.filter((d) => d.status === "delivered" || d.status === "cancelled"), [deliveries]);
  const selectedApplication = selectedDriver?.user_id ? applications.find((application) => application.user_id === selectedDriver.user_id) : null;

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
            <select value={nd.bank_name} onChange={(e) => setNd({ ...nd, bank_name: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
              <option value="">Select SA bank</option>
              {SA_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
            </select>
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                  <button type="button" onClick={() => void openDriver(d)} className="shrink-0 rounded-full" aria-label={`View ${d.name}'s information`}>{d.profile_image_url ? <img src={d.profile_image_url} alt={d.name} className="h-11 w-11 rounded-full object-cover" /> : <span className="grid h-11 w-11 place-items-center rounded-full bg-muted font-display text-brand">{d.name.slice(0,1)}</span>}</button>
                  <button type="button" onClick={() => void openDriver(d)} className="min-w-0 flex-1 text-left">
                    <div className="font-semibold text-sm">{d.name}</div>
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {d.phone}{d.branch_id && branches[d.branch_id] ? ` · ${branches[d.branch_id].name}` : ""}</div>
                    <div className="text-[11px] text-muted-foreground">★ {Number(d.rating ?? 0).toFixed(1)} · {d.rating_count ?? 0} reviews</div>
                  </button>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:flex-nowrap">
                  <select value={d.branch_id ?? ""} onChange={async (e) => {
                    const { error } = await supabase.from("drivers").update({ branch_id: e.target.value || null } as never).eq("id", d.id);
                    if (error) toast.error(error.message);
                    else {
                      setDrivers((prev) => prev.map((item) => item.id === d.id ? { ...item, branch_id: e.target.value || null } : item));
                      toast.success("Driver branch updated");
                      void logAdminAction({ action_type: "driver_profile_updated", action_description: `Updated branch for driver ${d.name}`, target_type: "driver", target_id: d.id, metadata: { before_branch_id: d.branch_id, after_branch_id: e.target.value || null } });
                    }
                  }} className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm sm:w-36 sm:flex-none">
                    <option value="">No branch</option>
                    {Object.values(branches).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " + (d.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>{d.approval_status ?? d.status}</span>
                  <button type="button" onClick={() => void openDriver(d)} className="rounded-full border px-3 py-1.5 text-xs font-bold text-brand">View</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <div className="mb-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                <div key={d.id} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
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
                  <select value={d.driver_id ?? ""} onChange={(e) => assignDriver(d.id, e.target.value || null)} className="w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-sm sm:w-44">
                    <option value="">Unassigned</option>
                    {drivers.filter((dr) => dr.approval_status === "approved").map((dr) => <option key={dr.id} value={dr.id}>{dr.name}</option>)}
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
      {selectedDriver && <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`${selectedDriver.name} driver information`} onClick={() => setSelectedDriver(null)}><div className="my-6 w-full max-w-2xl rounded-3xl border bg-background p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3">{selectedDriver.profile_image_url ? <ImagePreview src={selectedDriver.profile_image_url} alt={`${selectedDriver.name} profile picture`} className="h-20 w-20 rounded-full object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-full bg-muted font-display text-2xl text-brand">{selectedDriver.name.slice(0,1)}</div>}<div><h2 className="font-display text-3xl text-brand">{selectedDriver.name}</h2><div className="text-sm text-muted-foreground">{selectedDriver.phone} · {selectedDriver.status}</div><div className="text-sm">★ {Number(selectedDriver.rating ?? 0).toFixed(1)} from {selectedDriver.rating_count ?? 0} reviews</div></div></div><button type="button" onClick={() => setSelectedDriver(null)} className="grid h-9 w-9 place-items-center rounded-full border" aria-label="Close driver information"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><Info label="Branch" value={selectedDriver.branch_id ? branches[selectedDriver.branch_id]?.name : null} /><Info label="Approval" value={selectedDriver.approval_status} /><Info label="Bank" value={selectedDriver.bank_name} /><Info label="Account number" value={selectedDriver.bank_account_number} /><Info label="Account holder" value={selectedDriver.bank_account_holder} /><Info label="Applied" value={selectedApplication ? new Date(selectedApplication.created_at).toLocaleString() : null} /><Info label="Identity number" value={selectedApplication?.id_number} /><Info label="Licence number" value={selectedApplication?.student_number} /></div>
        {selectedApplication && <section className="mt-5"><h3 className="font-display text-xl text-brand">Application documents</h3><div className="mt-2 flex flex-wrap gap-3">{selectedApplication.profile_photo_url && <a href={selectedApplication.profile_photo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold"><ExternalLink className="h-3.5 w-3.5" /> Profile photo</a>}{selectedApplication.selfie_url && <a href={selectedApplication.selfie_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold"><ExternalLink className="h-3.5 w-3.5" /> Selfie with ID/licence</a>}{!selectedApplication.profile_photo_url && !selectedApplication.selfie_url && <div className="text-sm text-muted-foreground">No submitted document images.</div>}</div></section>}
        <section className="mt-5"><h3 className="font-display text-xl text-brand">Customer reviews and comments</h3><div className="mt-2 max-h-52 space-y-2 overflow-y-auto">{profileLoading && <div className="text-sm text-muted-foreground">Loading reviews…</div>}{!profileLoading && selectedReviews.length === 0 && <div className="text-sm text-muted-foreground">No customer reviews yet.</div>}{selectedReviews.map((review) => <div key={review.id} className="rounded-xl border p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-semibold">{"★".repeat(review.rating)} · Order {review.order_number}</span><span className="text-[10px] text-muted-foreground">{new Date(review.created_at).toLocaleDateString()}</span></div><div className="mt-1 text-muted-foreground">{review.comment || "No written comment."}</div></div>)}</div></section>
        {selectedDriver.approval_status === "suspended" && selectedDriver.suspended_until && <div className="mt-4 rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-800">Suspended until {new Date(selectedDriver.suspended_until).toLocaleString()}{selectedDriver.suspension_reason ? ` · ${selectedDriver.suspension_reason}` : ""}</div>}
        <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => suspendDriver(selectedDriver)} disabled={selectedDriver.approval_status === "suspended" && Boolean(selectedDriver.suspended_until) && new Date(selectedDriver.suspended_until!).getTime() > Date.now()} className="rounded-full bg-amber-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Suspend 24 hours</button><button onClick={() => { void removeDriver(selectedDriver.id); setSelectedDriver(null); }} className="rounded-full border border-destructive/50 px-3 py-2 text-xs font-semibold text-destructive">Delete driver</button></div>
      </div></div>}
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div className="rounded-xl bg-muted/50 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5 break-words text-sm font-semibold">{value || "Not provided"}</div></div>;
}
