import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Header } from "@/components/Header";
import { useCart } from "@/lib/cart";
import { useBranch } from "@/lib/branch";
import { formatZAR } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin, MapPinned, Loader2, Navigation, AlertTriangle, Bike, Phone, MessageCircle, Star, X } from "lucide-react";
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
import { ChatDialog } from "@/components/ChatDialog";
import { ImagePreview } from "@/components/ImagePreview";
import { sendOrderEventEmail } from "@/lib/order-email";
import { LocationPickerDialog } from "@/components/LocationPickerDialog";
import { useQuery } from "@tanstack/react-query";
import { menuQuery } from "@/lib/menu-queries";

type CheckoutDriver = { driver_id: string; user_id: string; name: string; profile_image_url: string | null; phone: string; rating: number; distance_km: number | null; status: "online" | "offline" };
type DriverReview = { rating: number; comment: string | null; created_at: string };
type SubmittedOrder = { id: string; number: string; driver: CheckoutDriver; totalCents: number };

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
  const { data: menuData } = useQuery(menuQuery);
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
  const [drivers, setDrivers] = useState<CheckoutDriver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [driverReviews, setDriverReviews] = useState<Record<string, DriverReview[]>>({});
  const [submittedOrder, setSubmittedOrder] = useState<SubmittedOrder | null>(null);
  const [storeOpen, setStoreOpen] = useState<boolean | null>(null);
  const [closedMessage, setClosedMessage] = useState("Online ordering is closed right now. Please check back when Champs reopens.");
  const [savedHome, setSavedHome] = useState<{ address: string; lat: number; lng: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [drinkChoices, setDrinkChoices] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    fulfillment: "pickup" as "pickup" | "delivery",
    delivery_notes: "",
    delivery_address: "",
  });
  const drinkOptions = useMemo(() => {
    if (!menuData) return [];
    const drinkCategoryIds = new Set(menuData.categories.filter((category) => category.slug === "drinks").map((category) => category.id));
    return menuData.items
      .filter((item) => item.is_available && drinkCategoryIds.has(item.category_id))
      .map((item) => item.variant_label ? `${item.name} — ${item.variant_label}` : item.name)
      .filter((label, index, all) => all.indexOf(label) === index);
  }, [menuData]);
  const drinkRequiredItemIds = useMemo(() => new Set(items.filter((item) => {
    const authoritative = menuData?.items.find((menuItem) => menuItem.id === (item.menu_item_id ?? item.id));
    return item.comes_with_drink ?? authoritative?.comes_with_drink ?? false;
  }).map((item) => item.id)), [items, menuData]);

  useEffect(() => {
    fetchDeliverySettings().then(setSettings).catch(() => {});
    fetchActiveDeliveryCount().then(setActiveCount).catch(() => {});
    fetchOnlineDriverCount().then(setDriversOnline).catch(() => setDriversOnline(0));
    const loadShopStatus = async () => {
      const { data } = await (supabase.from("site_settings") as any).select("online_ordering_open,online_ordering_closed_message").eq("id", "main").maybeSingle();
      setStoreOpen(data?.online_ordering_open !== false);
      if (data?.online_ordering_closed_message) setClosedMessage(data.online_ordering_closed_message);
    };
    void loadShopStatus();
    const ch = supabase
      .channel("checkout-drivers")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => {
        fetchOnlineDriverCount().then(setDriversOnline).catch(() => {});
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => {
        fetchActiveDeliveryCount().then(setActiveCount).catch(() => {});
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "delivery_settings", filter: "id=eq.default" }, () => {
        fetchDeliverySettings().then(setSettings).catch(() => {});
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "site_settings", filter: "id=eq.main" }, () => void loadShopStatus())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (form.fulfillment !== "delivery" || !userId) { setDrivers([]); setSelectedDriverId(""); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase.rpc as any)("list_available_drivers", { _latitude: coords?.lat ?? null, _longitude: coords?.lng ?? null, _branch_id: branch?.id ?? null });
      if (cancelled) return;
      if (error) { toast.error("Could not load drivers"); return; }
      const list = (data ?? []) as CheckoutDriver[];
      setDrivers(list);
      const reviewEntries = await Promise.all(list.map(async (driver) => {
        const { data: reviews } = await (supabase.rpc as any)("get_driver_reviews", { _driver_id: driver.driver_id });
        return [driver.driver_id, (reviews ?? []) as DriverReview[]] as const;
      }));
      if (!cancelled) setDriverReviews(Object.fromEntries(reviewEntries));
      setSelectedDriverId((current) => list.some((driver) => driver.driver_id === current && driver.status === "online") ? current : (list.find((driver) => driver.status === "online")?.driver_id ?? ""));
    })();
    return () => { cancelled = true; };
  }, [form.fulfillment, userId, coords?.lat, coords?.lng, branch?.id]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        setUserId(u.user.id);
        const { data: profile } = await (supabase
          .from("profiles")
          .select("full_name,phone,home_address,home_lat,home_lng") as any)
          .eq("id", u.user.id)
          .maybeSingle();
        if (profile) {
          setForm((f) => ({
            ...f,
            customer_name: f.customer_name || profile.full_name || "",
            customer_phone: f.customer_phone || profile.phone || "",
          }));
          if (profile.home_address && profile.home_lat != null && profile.home_lng != null) setSavedHome({ address: profile.home_address, lat: profile.home_lat, lng: profile.home_lng });
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
  const deliveryCurrentlyAvailable = customerDeliveryAllowed && (driversOnline ?? 0) > 0;

  useEffect(() => {
    if (!settings.pickup_enabled && deliveryCurrentlyAvailable && form.fulfillment === "pickup") {
      setForm((current) => ({ ...current, fulfillment: "delivery" }));
    } else if (!deliveryCurrentlyAvailable && settings.pickup_enabled && form.fulfillment === "delivery") {
      setForm((current) => ({ ...current, fulfillment: "pickup" }));
    }
  }, [settings.pickup_enabled, deliveryCurrentlyAvailable, form.fulfillment]);
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

  function useSavedHome() {
    if (!savedHome) return;
    setForm((current) => ({ ...current, delivery_address: savedHome.address }));
    setCoords({ lat: savedHome.lat, lng: savedHome.lng });
    setAddressConfirmed(true);
  }

  async function saveCurrentAsHome() {
    if (!userId || !coords || !addressConfirmed || !form.delivery_address.trim()) return;
    const next = { address: form.delivery_address.trim(), lat: coords.lat, lng: coords.lng };
    const { error } = await (supabase.from("profiles") as any).update({ home_address: next.address, home_lat: next.lat, home_lng: next.lng }).eq("id", userId);
    if (error) return toast.error(error.message);
    setSavedHome(next);
    toast.success("Home address saved");
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
    const { data: latestShop } = await (supabase.from("site_settings") as any).select("online_ordering_open,online_ordering_closed_message").eq("id", "main").maybeSingle();
    if (latestShop?.online_ordering_open === false) {
      setStoreOpen(false);
      if (latestShop.online_ordering_closed_message) setClosedMessage(latestShop.online_ordering_closed_message);
      return toast.error(latestShop.online_ordering_closed_message || closedMessage);
    }
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (!userId) return toast.error("Please sign in before placing an order so only you can track it");
    if (parsed.data.fulfillment === "pickup" && !settings.pickup_enabled) return toast.error("Pickup is currently disabled");
    const missingDrink = items.find((item) => drinkRequiredItemIds.has(item.id) && !drinkChoices[item.id]);
    if (missingDrink) return toast.error(`Choose the included drink for ${missingDrink.name}`);

    if (parsed.data.fulfillment === "delivery") {
      if (!userId) return toast.error("Please sign in before choosing and messaging a driver");
      if (!selectedDriverId) return toast.error("Choose an online driver");
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
          driver_id: isDelivery ? selectedDriverId : null,
          workflow_status: isDelivery ? "pending_driver_acceptance" : "pickup_pending",
        } as never)
        .select("id, order_number")
        .single();
      if (oErr) throw oErr;

      if (isDelivery) {
        // Give the selected driver ten minutes to accept before offering reassignment.
        const now = new Date();
        const deadline = new Date(now.getTime() + 10 * 60_000);
        await (supabase.from("deliveries") as any).upsert({
          order_id: orderRow.id,
          driver_id: selectedDriverId,
          distance_km: quote?.ok ? quote.distance_km : null,
          delivery_fee_cents: deliveryFee,
          status: "pending_driver_acceptance",
          broadcast_at: now.toISOString(),
          assign_deadline_at: deadline.toISOString(),
        }, { onConflict: "order_id" });
      }

      const { error: iErr } = await supabase.from("order_items").insert(
        items.map((i) => ({
          order_id: orderRow.id,
          menu_item_id: i.menu_item_id ?? i.id,
          item_name: `${i.variant ? `${i.name} — ${i.variant}` : i.name}${drinkRequiredItemIds.has(i.id) ? ` · Drink: ${drinkChoices[i.id]}` : ""}`,
          unit_price_cents: i.unit_price_cents,
          quantity: i.quantity,
        })),
      );
      if (iErr) throw iErr;
      void sendOrderEventEmail(orderRow.id, "created");

      try {
        const list = JSON.parse(localStorage.getItem("champs-orders") || "[]");
        list.unshift(orderRow.order_number);
        localStorage.setItem("champs-orders", JSON.stringify(list.slice(0, 10)));
      } catch {}

      if (isDelivery) {
        const chosen = drivers.find((driver) => driver.driver_id === selectedDriverId);
        if (!chosen) throw new Error("Selected driver is no longer available");
        setSubmittedOrder({ id: orderRow.id, number: orderRow.order_number, driver: chosen, totalCents });
        clear();
      } else {
        clear();
        nav({ to: "/order/$number", params: { number: orderRow.order_number } });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Could not place order");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen pb-10">
      <Header subtitle="Checkout" />
      <form onSubmit={submit} className="mx-auto max-w-lg px-4 py-4 space-y-5">
        {storeOpen === false && <div className="rounded-2xl border border-amber-500/40 bg-amber-50 px-4 py-4 text-sm text-amber-900"><div className="font-bold">Online ordering is currently closed</div><div className="mt-1">{closedMessage}</div></div>}
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
          {!settings.pickup_enabled && deliveryCurrentlyAvailable && (
            <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs flex items-start gap-2">
              <Bike className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
              <span>Pickup is temporarily unavailable, but delivery is available with an online driver.</span>
            </div>
          )}
          {!settings.pickup_enabled && !deliveryCurrentlyAvailable && (
            <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Pickup and delivery aren't available right now. {storeOpen === false ? closedMessage : "Please order directly from the branch."}
            </div>
          )}
          {settings.pickup_enabled && !deliveryCurrentlyAvailable && (
            <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Delivery is temporarily unavailable because no eligible driver has capacity. Pickup is still available.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(["pickup", "delivery"] as const).map((v) => {
              const disabled = v === "pickup" ? !settings.pickup_enabled : !deliveryCurrentlyAvailable;
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
              <div className="grid gap-2 sm:grid-cols-2">
                {savedHome && <button type="button" onClick={useSavedHome} className="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold"><MapPin className="h-4 w-4 text-brand" /> Use saved home</button>}
                <button type="button" onClick={() => setMapOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold"><MapPinned className="h-4 w-4 text-brand" /> Choose pin on map</button>
              </div>
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
              {addressConfirmed && coords && <button type="button" onClick={() => void saveCurrentAsHome()} className="text-xs font-semibold text-brand underline">Save this as my home address</button>}
              {userId ? (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Choose your driver</div>
                  {drivers.length === 0 ? <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">No approved drivers are available.</div> : drivers.map((driver) => (
                    <div key={driver.driver_id} role="button" tabIndex={driver.status === "online" ? 0 : -1} aria-disabled={driver.status !== "online"} onClick={() => driver.status === "online" && setSelectedDriverId(driver.driver_id)} onKeyDown={(event) => { if (driver.status === "online" && (event.key === "Enter" || event.key === " ")) setSelectedDriverId(driver.driver_id); }} className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left ${selectedDriverId === driver.driver_id ? "border-brand bg-brand/5" : "border-border bg-card"} ${driver.status !== "online" ? "opacity-60" : "cursor-pointer"}`}>
                      {driver.profile_image_url ? <ImagePreview src={driver.profile_image_url} alt={`${driver.name} profile picture`} className="h-11 w-11 rounded-full object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-full bg-muted font-display text-brand">{driver.name.slice(0, 1)}</div>}
                      <div className="min-w-0 flex-1"><div className="font-semibold">{driver.name}</div><div className="text-xs text-muted-foreground">{driver.phone} · {driver.distance_km == null ? "Distance unavailable" : `${Number(driver.distance_km).toFixed(1)} km`}</div>{driverReviews[driver.driver_id]?.[0]?.comment && <div className="mt-1 truncate text-[11px] italic text-muted-foreground">“{driverReviews[driver.driver_id][0].comment}”</div>}</div>
                      <div className="text-right"><div className={`text-[10px] font-bold uppercase ${driver.status === "online" ? "text-emerald-600" : "text-muted-foreground"}`}>{driver.status === "online" ? "● Online" : "○ Offline"}</div><div className="mt-1 inline-flex items-center gap-1 text-xs"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {Number(driver.rating || 0).toFixed(1)}</div></div>
                    </div>
                  ))}
                  <a href="/account#complaints" className="inline-flex text-xs font-semibold text-destructive underline">Report a driver or submit a complaint</a>
                </div>
              ) : (
                <Link to="/auth" className="block rounded-xl border border-brand/30 bg-brand/5 p-3 text-center text-sm font-semibold text-brand">Sign in to choose and chat with a driver</Link>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm space-y-1.5">
            {items.map((i) => (
              <div key={i.id} className="space-y-2">
                <div className="flex justify-between gap-3">
                  <span className="flex items-center gap-2 truncate">
                    <img src={i.image_url ? i.image_url : getMenuImageForItem(i.name, i.variant).src} alt={i.name} className="h-8 w-8 rounded-md object-cover" />
                    <span className="truncate"><span className="font-bold text-brand">{i.quantity}×</span> {i.name}{i.variant ? ` — ${i.variant}` : ""}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatZAR(i.unit_price_cents * i.quantity)}</span>
                </div>
                {drinkRequiredItemIds.has(i.id) && <label className="block rounded-xl border border-brand/25 bg-brand/5 p-3"><span className="mb-1 block text-xs font-bold text-brand">Included drink{i.quantity > 1 ? ` for all ${i.quantity}` : ""}</span><select required aria-label={`Choose the included drink for ${i.name}`} value={drinkChoices[i.id] ?? ""} onChange={(event) => setDrinkChoices((current) => ({ ...current, [i.id]: event.target.value }))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"><option value="">Choose your drink</option>{drinkOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>{drinkOptions.length === 0 && <span className="mt-1 block text-xs text-destructive">No drinks are available. Please contact Champs before ordering this special.</span>}</label>}
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
              <span className="font-bold">Full amount</span>
              <span className="font-display text-xl text-brand">{formatZAR(totalCents)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">For delivery, confirm the order with your driver and send the full amount shown above: food plus delivery.</p>
        </section>

        <button
          type="submit"
          disabled={submitting || !branch || storeOpen !== true || items.some((item) => drinkRequiredItemIds.has(item.id) && !drinkChoices[item.id]) || (form.fulfillment === "delivery" && (!deliveryEligibility.allowed || !quote?.ok))}
          className="w-full rounded-full bg-brand py-4 text-sm font-bold text-brand-foreground hover:bg-brand-dark disabled:opacity-60"
        >
          {submitting ? "Sending order…" : form.fulfillment === "delivery" ? `Send Order to Driver · ${formatZAR(totalCents)}` : `Place order · ${formatZAR(subtotalCents)}`}
        </button>
      </form>
      <LocationPickerDialog open={mapOpen} initial={coords} fallback={branch?.latitude != null && branch?.longitude != null ? { lat: branch.latitude, lng: branch.longitude } : null} onClose={() => setMapOpen(false)} onConfirm={(location) => { setForm((current) => ({ ...current, delivery_address: location.address })); setCoords({ lat: location.lat, lng: location.lng }); setAddressConfirmed(true); setMapOpen(false); }} />
      {submittedOrder && (
        <div className="fixed inset-0 z-[75] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl border bg-background p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-2xl text-brand">Order sent</h2><p className="mt-1 text-sm text-muted-foreground">Your order has been sent. Please confirm with the driver.</p></div><button type="button" onClick={() => nav({ to: "/order/$number", params: { number: submittedOrder.number } })} className="grid h-9 w-9 place-items-center rounded-full border"><X className="h-4 w-4" /></button></div>
            <div className="mt-5 rounded-2xl bg-muted/40 p-4"><div className="font-semibold">{submittedOrder.driver.name}</div><div className="text-xs text-muted-foreground">{submittedOrder.driver.phone}</div><div className="mt-2 text-sm">Send the driver the full amount: <span className="font-display text-brand">{formatZAR(submittedOrder.totalCents)}</span></div></div>
            <div className="mt-4 grid gap-2">
              <ChatDialog orderId={submittedOrder.id} label="In-App Chat" className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground" />
              <a href={`https://wa.me/${submittedOrder.driver.phone.replace(/\D/g, "").replace(/^0/, "27")}?text=${encodeURIComponent(`Hi ${submittedOrder.driver.name}, please confirm Champs order ${submittedOrder.number}. The full amount (food + delivery) is ${formatZAR(submittedOrder.totalCents)}.`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] py-3 text-sm font-bold text-white"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
              <a href={`tel:${submittedOrder.driver.phone}`} className="inline-flex items-center justify-center gap-2 rounded-full border py-3 text-sm font-bold"><Phone className="h-4 w-4" /> Call</a>
              <button type="button" onClick={() => nav({ to: "/order/$number", params: { number: submittedOrder.number } })} className="py-2 text-sm font-semibold text-brand">View order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
