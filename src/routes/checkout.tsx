import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Header } from "@/components/Header";
import { useCart } from "@/lib/cart";
import { useBranch } from "@/lib/branch";
import { formatZAR } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin, Loader2, Navigation, AlertTriangle, Bike } from "lucide-react";
import {
  DEFAULT_DELIVERY_SETTINGS,
  fetchDeliverySettings,
  fetchActiveDeliveryCount,
  fetchOnlineDriverCount,
  getBrowserLocation,
  getRoadDistanceKm,
  reverseGeocodeCoordinates,
  quoteDelivery,
  computeMode,
  computeEtaRange,
  getCartDeliveryEligibility,
  distanceKm,
  type DeliverySettings,
  type DeliveryQuote,
} from "@/lib/delivery";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { getMenuImageForItem } from "@/lib/menu-images";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Champs Chicken" },
      { name: "description", content: "Complete your Champs Chicken order for pickup or delivery." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Checkout,
});

const saPhoneRegex = /^(?:\+?27|0)[1-8]\d{8}$/;

const schema = z.object({
  customer_name: z.string().trim().min(1, "Please enter your name").max(100),
  customer_phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s\-()]/g, ""))
    .refine((v) => saPhoneRegex.test(v), {
      message: "Enter a valid SA number, e.g. 082 123 4567 or +27 82 123 4567",
    }),
  fulfillment: z.enum(["pickup", "delivery"]),
  delivery_notes: z.string().max(500).optional(),
  delivery_address: z.string().max(500).optional(),
});

function Checkout() {
  const nav = useNavigate();
  const { items, subtotalCents, clear } = useCart();
  const { active: branch } = useBranch();
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [roadDistanceKm, setRoadDistanceKm] = useState<number | null>(null);
  const [distanceBusy, setDistanceBusy] = useState(false);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [driversOnline, setDriversOnline] = useState<number | null>(null);
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    fulfillment: "pickup" as "pickup" | "delivery",
    delivery_notes: "",
    delivery_address: "",
  });

  useEffect(() => {
    fetchDeliverySettings().then(setSettings).catch(() => {});
    fetchActiveDeliveryCount().then(setActiveCount).catch(() => {});
    fetchOnlineDriverCount().then(setDriversOnline).catch(() => setDriversOnline(0));
    const ch = supabase
      .channel("checkout-drivers")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => {
        fetchOnlineDriverCount().then(setDriversOnline).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        setUserId(u.user.id);
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, phone")
          .eq("id", u.user.id)
          .maybeSingle();
        if (profile) {
          setForm((f) => ({
            ...f,
            customer_name: f.customer_name || profile.full_name || "",
            customer_phone: f.customer_phone || profile.phone || "",
          }));
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (form.fulfillment !== "delivery") {
      setRoadDistanceKm(null);
      setDistanceError(null);
      return;
    }
    if (!addressConfirmed || !branch?.latitude || !branch?.longitude || !coords) {
      setRoadDistanceKm(null);
      setDistanceError(null);
      return;
    }

    let cancelled = false;
    setDistanceBusy(true);
    setDistanceError(null);

    getRoadDistanceKm(
      { lat: branch.latitude, lng: branch.longitude },
      coords,
    )
      .then((d) => {
        if (!cancelled) setRoadDistanceKm(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setRoadDistanceKm(null);
          setDistanceError(err instanceof Error ? err.message : "Could not calculate delivery distance");
        }
      })
      .finally(() => {
        if (!cancelled) setDistanceBusy(false);
      });

    return () => { cancelled = true; };
  }, [form.fulfillment, branch?.latitude, branch?.longitude, coords?.lat, coords?.lng, addressConfirmed]);

  const deliveryEligibility = useMemo(() => getCartDeliveryEligibility(items, subtotalCents), [items, subtotalCents]);
  const customerDeliveryAllowed = settings.delivery_enabled && !settings.drivers_dial_up_only;
  const quote: DeliveryQuote | null = useMemo(() => {
    if (form.fulfillment !== "delivery") return null;
    if (!deliveryEligibility.allowed) return null;
    if (!branch?.latitude || !branch?.longitude || !coords || roadDistanceKm == null) return null;
    return quoteDelivery(roadDistanceKm, settings, form.delivery_address);
  }, [form.fulfillment, deliveryEligibility.allowed, branch, coords, settings, roadDistanceKm, form.delivery_address]);

  const deliveryFee = quote?.ok ? quote.fee_cents : 0;
  const totalCents = subtotalCents + deliveryFee;

  async function useMyLocation() {
    setLocating(true);
    try {
      const loc = await getBrowserLocation();
      setCoords(loc);
      try {
        const address = await reverseGeocodeCoordinates(loc.lat, loc.lng);
        setForm((f) => ({ ...f, delivery_address: address }));
        setAddressConfirmed(true);
      } catch {
        setForm((f) => ({ ...f, delivery_address: `Current location (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})` }));
        setAddressConfirmed(true);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Could not read your location");
    } finally {
      setLocating(false);
    }
  }

  if (items.length === 0 && !submitting) {
    return (
      <div className="min-h-screen">
        <Header subtitle="Checkout" />
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">Your cart is empty.</p>
          <Link to="/menu" className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 text-sm font-bold text-brand-foreground">Browse menu</Link>
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!branch) return toast.error("Please choose a branch first");
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    if (parsed.data.fulfillment === "delivery") {
      if (!customerDeliveryAllowed) return toast.error(settings.delivery_enabled ? "Customer delivery is temporarily unavailable" : "Delivery is currently disabled");
      if (!deliveryEligibility.allowed) return toast.error(deliveryEligibility.reason ?? "Delivery unavailable for this order");
      if (!coords) return toast.error("Please share your delivery location");
      if (!addressConfirmed) return toast.error("Please confirm your delivery address by selecting a suggestion or using your current location");
      if (!quote?.ok) return toast.error(quote?.reason ?? "Please confirm a valid delivery address and try again");
    }

    setSubmitting(true);
    try {
      const isDelivery = parsed.data.fulfillment === "delivery";
      const { data: orderRow, error: oErr } = await supabase
        .from("orders")
        .insert({
          customer_name: parsed.data.customer_name,
          customer_phone: parsed.data.customer_phone,
          fulfillment: parsed.data.fulfillment,
          delivery_notes: parsed.data.delivery_notes || null,
          subtotal_cents: subtotalCents,
          branch_id: branch.id,
          user_id: userId,
          delivery_address: isDelivery ? (parsed.data.delivery_address?.trim() || `${coords?.lat?.toFixed(4) || 0}, ${coords?.lng?.toFixed(4) || 0}`) : null,
          delivery_lat: isDelivery && coords ? coords.lat : null,
          delivery_lng: isDelivery && coords ? coords.lng : null,
          delivery_fee_cents: isDelivery ? deliveryFee : 0,
          distance_km: isDelivery && quote?.ok ? quote.distance_km : null,
          delivery_status: isDelivery ? "pending" : null,
        } as never)
        .select("id, order_number")
        .single();
      if (oErr) throw oErr;

      if (isDelivery) {
        // Seed the delivery row with a 20s broadcast window before auto-assignment
        const now = new Date();
        const deadline = new Date(now.getTime() + 20_000);
        await (supabase.from("deliveries") as any).upsert({
          order_id: orderRow.id,
          distance_km: quote?.ok ? quote.distance_km : null,
          delivery_fee_cents: deliveryFee,
          status: "pending",
          broadcast_at: now.toISOString(),
          assign_deadline_at: deadline.toISOString(),
        }, { onConflict: "order_id" });
      }

      const { error: iErr } = await supabase.from("order_items").insert(
        items.map((i) => ({
          order_id: orderRow.id,
          menu_item_id: i.id,
          item_name: i.variant ? `${i.name} — ${i.variant}` : i.name,
          unit_price_cents: i.unit_price_cents,
          quantity: i.quantity,
        })),
      );
      if (iErr) throw iErr;

      try {
        const list = JSON.parse(localStorage.getItem("champs-orders") || "[]");
        list.unshift(orderRow.order_number);
        localStorage.setItem("champs-orders", JSON.stringify(list.slice(0, 10)));
      } catch {}

      clear();
      nav({ to: "/order/$number", params: { number: orderRow.order_number } });
    } catch (err: any) {
      toast.error(err.message ?? "Could not place order");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen pb-10">
      <Header subtitle="Checkout" />
      <form onSubmit={submit} className="mx-auto max-w-lg px-4 py-4 space-y-5">
        {branch && (
          <div className="rounded-xl bg-brand/5 border border-brand/20 px-4 py-3 text-xs flex items-center gap-2">
            <MapPin className="h-4 w-4 text-brand" />
            <span>Ordering from <span className="font-bold">{branch.name}</span> · {branch.address}, {branch.city}</span>
          </div>
        )}
        <section>
          <h2 className="font-display text-xl mb-2">Your details</h2>
          <div className="space-y-3">
            <input
              className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="Full name"
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              required
            />
            <input
              className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="Phone (e.g. 082 123 4567)"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.customer_phone}
              onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
              required
            />
            {!userId && (
              <p className="text-[11px] text-muted-foreground">
                <Link to="/auth" className="underline text-brand font-semibold">Sign in</Link> to save this order to your history and unlock reordering.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="font-display text-xl mb-2">Order type</h2>
          {driversOnline === 0 && (
            <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs flex items-start gap-2">
              <Bike className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
              <span>Delivery currently unavailable — no drivers online. You can still order for pickup.</span>
            </div>
          )}
          {!customerDeliveryAllowed && (
            <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {settings.delivery_enabled ? "Customer delivery is temporarily unavailable. Pickup is still available." : "Delivery is currently disabled. Pickup is still available."}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(["pickup", "delivery"] as const).map((v) => {
              const disabled = v === "delivery" && (!customerDeliveryAllowed || driversOnline === 0);
              return (
                <button
                  type="button"
                  key={v}
                  disabled={disabled}
                  onClick={() => !disabled && setForm({ ...form, fulfillment: v })}
                  className={
                    "rounded-xl border-2 px-4 py-4 text-sm font-bold uppercase tracking-wider transition-colors " +
                    (form.fulfillment === v ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card text-muted-foreground") +
                    (disabled ? " opacity-40 cursor-not-allowed" : "")
                  }
                >
                  {v}
                </button>
              );
            })}
          </div>

          {form.fulfillment === "delivery" && (
            <div className="mt-3 space-y-3">
              {!deliveryEligibility.allowed && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                  {deliveryEligibility.reason}
                </div>
              )}
              <AddressAutocomplete
                value={form.delivery_address}
                onChange={(v) => {
                  setForm((f) => ({ ...f, delivery_address: v }));
                  setAddressConfirmed(false);
                  setRoadDistanceKm(null);
                  setDistanceError(null);
                }}
                onSelect={({ address, lat, lng }) => {
                  setForm((f) => ({ ...f, delivery_address: address }));
                  setCoords({ lat, lng });
                  setAddressConfirmed(true);
                }}
                placeholder="Delivery address (start typing to search)"
                bias={branch?.latitude && branch?.longitude ? { lat: branch.latitude, lng: branch.longitude } : undefined}
              />
              <textarea
                className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                placeholder="Residence / hostel / building or driver note (optional)"
                rows={2}
                value={form.delivery_notes}
                onChange={(e) => setForm({ ...form, delivery_notes: e.target.value })}
              />



              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="w-full rounded-xl border-2 border-brand/40 bg-brand/5 px-4 py-3 text-sm font-bold text-brand inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
                {coords ? "Update my location" : "Use my current location"}
              </button>

              {!addressConfirmed && form.delivery_address.trim().length > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                  Confirm the address by selecting a suggestion or using your current location before placing the order.
                </div>
              )}

              {coords && quote && (
                quote.ok ? (
                  (() => {
                    const mode = computeMode(activeCount, settings);
                    const eta = computeEtaRange(1, settings, mode, roadDistanceKm ?? undefined);
                    return (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Distance</span>
                          <span className="font-bold">{quote.distance_km.toFixed(2)} km</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">Delivery fee</span>
                          <span className="font-display text-lg text-brand">{formatZAR(quote.fee_cents)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between border-t border-emerald-600/20 pt-2">
                          <span className="text-muted-foreground">Estimated delivery</span>
                          <span className="font-bold">{eta.min}–{eta.max} min</span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground flex items-center justify-between">
                          <span>{mode === "peak" ? "Peak demand — we're batching a bit slower to keep quality up." : "Orders are grouped for faster delivery and efficiency."}</span>
                          <span className={"ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " + (mode === "peak" ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700")}>{mode}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                    <div>
                      <div className="font-bold text-destructive">{quote.reason}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">You're {quote.distance_km.toFixed(2)} km away — our max delivery radius is {settings.max_radius_km} km. Please choose pickup or a closer branch.</div>
                    </div>
                  </div>
                )
              )}

              {distanceBusy && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating live road distance…
                </div>
              )}
              {distanceError && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                  {distanceError}
                </div>
              )}
              {!coords && (
                <p className="text-[11px] text-muted-foreground">
                  Delivery fees: 0–{settings.tier1_max_km}km {formatZAR(settings.tier1_fee_cents)} · {settings.tier1_max_km}–{settings.tier2_max_km}km {formatZAR(settings.tier2_fee_cents)} · {settings.tier2_max_km}–{settings.tier3_max_km}km {formatZAR(settings.tier3_fee_cents)}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm space-y-1.5">
            {items.map((i) => (
              <div key={i.id} className="flex justify-between gap-3">
                <span className="flex items-center gap-2 truncate">
                  <img src={i.image_url ? i.image_url : getMenuImageForItem(i.name, i.variant).src} alt={i.name} className="h-8 w-8 rounded-md object-cover" />
                  <span className="truncate"><span className="font-bold text-brand">{i.quantity}×</span> {i.name}{i.variant ? ` — ${i.variant}` : ""}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatZAR(i.unit_price_cents * i.quantity)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between text-xs">
              <span className="text-muted-foreground">Food total</span>
              <span className="tabular-nums">{formatZAR(subtotalCents)}</span>
            </div>
            {form.fulfillment === "delivery" && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Delivery fee</span>
                <span className="tabular-nums">{quote?.ok ? formatZAR(deliveryFee) : "—"}</span>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-border pt-3">
              <span className="font-bold">Pay now</span>
              <span className="font-display text-xl text-brand">{formatZAR(subtotalCents)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Food is paid now at checkout. Delivery is paid separately to your driver after the order is delivered.</p>
        </section>

        <button
          type="submit"
          disabled={submitting || !branch || (form.fulfillment === "delivery" && (!deliveryEligibility.allowed || !quote?.ok))}
          className="w-full rounded-full bg-brand py-4 text-sm font-bold text-brand-foreground hover:bg-brand-dark disabled:opacity-60"
        >
          {submitting ? "Placing order…" : `Place order · ${formatZAR(subtotalCents)}`}
        </button>
      </form>
    </div>
  );
}
