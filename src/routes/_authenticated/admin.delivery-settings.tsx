import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DEFAULT_DELIVERY_SETTINGS, fetchDeliverySettings, type DeliverySettings } from "@/lib/delivery";
import { logAdminAction } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/admin/delivery-settings")({
  head: () => ({ meta: [{ title: "Delivery Settings — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: DeliverySettingsPage,
});

function DeliverySettingsPage() {
  const [s, setS] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchDeliverySettings().then(setS).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("delivery_settings").update(s as never).eq("id", "default");
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Delivery settings saved");
    void logAdminAction({ action_type: "delivery_settings_updated", action_description: "Updated delivery settings", target_type: "delivery_settings", target_id: "default", metadata: { settings: s } });
  }

  const field = (label: string, key: keyof DeliverySettings, step: number | string = 0.1, hint?: string) => (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <input
        type="number"
        step={step as number}
        value={s[key]}
        onChange={(e) => setS({ ...s, [key]: Number(e.target.value) })}
        className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
      />
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </label>
  );

  if (loading) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>;

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Admin</Link>
          <div className="font-display text-xl text-brand">Delivery Settings</div>
          <div className="w-16" />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-display text-lg text-brand mb-3">Radius</h2>
          {field("Max delivery radius (km)", "max_radius_km")}
        </section>

        <section className="rounded-2xl border bg-card p-4 space-y-3">
          <h2 className="font-display text-lg text-brand">Fee tiers</h2>
          <div className="grid grid-cols-2 gap-3">
            {field("Tier 1 max km", "tier1_max_km")}
            {field("Tier 1 fee (cents)", "tier1_fee_cents", 100)}
            {field("Tier 2 max km", "tier2_max_km")}
            {field("Tier 2 fee (cents)", "tier2_fee_cents", 100)}
            {field("Tier 3 max km", "tier3_max_km")}
            {field("Tier 3 fee (cents)", "tier3_fee_cents", 100)}
          </div>
          <p className="text-xs text-muted-foreground">Fees are in cents (2500 = R25.00). Distance is measured in a straight line from the branch to the customer.</p>
        </section>

        <section className="rounded-2xl border bg-card p-4 space-y-3">
          <h2 className="font-display text-lg text-brand">ETA engine</h2>
          <div className="grid grid-cols-2 gap-3">
            {field("Base prep time (min)", "base_prep_min", 1, "Kitchen prep time before dispatch.")}
            {field("Avg stop time (min)", "avg_stop_min", 1, "Time per additional stop in a batch.")}
          </div>
          <p className="text-xs text-muted-foreground">Customer ETA = base + (queue position × avg stop). Peak mode widens the range.</p>
        </section>

        <section className="rounded-2xl border bg-card p-4 space-y-3">
          <h2 className="font-display text-lg text-brand">Batching & peak mode</h2>
          <div className="grid grid-cols-2 gap-3">
            {field("Peak mode threshold (active orders)", "peak_threshold", 1, "Switch to peak mode when active deliveries hit this number.")}
            {field("Max wait before dispatch (min)", "max_wait_min", 1, "Do not delay an early order longer than this to batch more.")}
            {field("Normal capacity min", "normal_capacity_min", 1)}
            {field("Normal capacity max", "normal_capacity_max", 1)}
            {field("Peak capacity min", "peak_capacity_min", 1)}
            {field("Peak capacity max", "peak_capacity_max", 1)}
          </div>
        </section>

        <button onClick={save} disabled={saving} className="w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
        </button>
      </div>
    </div>
  );
}
