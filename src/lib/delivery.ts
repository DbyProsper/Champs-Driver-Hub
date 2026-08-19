import { supabase } from "@/integrations/supabase/client";

export type DeliverySettings = {
  max_radius_km: number;
  tier1_max_km: number;
  tier1_fee_cents: number;
  tier2_max_km: number;
  tier2_fee_cents: number;
  tier3_max_km: number;
  tier3_fee_cents: number;
  base_prep_min: number;
  avg_stop_min: number;
  peak_threshold: number;
  max_wait_min: number;
  normal_capacity_min: number;
  normal_capacity_max: number;
  peak_capacity_min: number;
  peak_capacity_max: number;
  manual_peak_mode?: boolean;
  delivery_enabled: boolean;
  drivers_dial_up_only: boolean;
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  max_radius_km: 6,
  tier1_max_km: 2,
  tier1_fee_cents: 2500,
  tier2_max_km: 4,
  tier2_fee_cents: 4000,
  tier3_max_km: 6,
  tier3_fee_cents: 5500,
  base_prep_min: 25,
  avg_stop_min: 8,
  peak_threshold: 8,
  max_wait_min: 10,
  normal_capacity_min: 3,
  normal_capacity_max: 5,
  peak_capacity_min: 2,
  peak_capacity_max: 4,
  manual_peak_mode: false,
  delivery_enabled: true,
  drivers_dial_up_only: false,
};

export async function fetchDeliverySettings(): Promise<DeliverySettings> {
  const { data } = await supabase
    .from("delivery_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (!data) return DEFAULT_DELIVERY_SETTINGS;
  const d = data as Record<string, unknown>;
  const num = (k: string, fallback: number) => (d[k] == null ? fallback : Number(d[k]));
  return {
    max_radius_km: num("max_radius_km", DEFAULT_DELIVERY_SETTINGS.max_radius_km),
    tier1_max_km: num("tier1_max_km", DEFAULT_DELIVERY_SETTINGS.tier1_max_km),
    tier1_fee_cents: num("tier1_fee_cents", DEFAULT_DELIVERY_SETTINGS.tier1_fee_cents),
    tier2_max_km: num("tier2_max_km", DEFAULT_DELIVERY_SETTINGS.tier2_max_km),
    tier2_fee_cents: num("tier2_fee_cents", DEFAULT_DELIVERY_SETTINGS.tier2_fee_cents),
    tier3_max_km: num("tier3_max_km", DEFAULT_DELIVERY_SETTINGS.tier3_max_km),
    tier3_fee_cents: num("tier3_fee_cents", DEFAULT_DELIVERY_SETTINGS.tier3_fee_cents),
    base_prep_min: num("base_prep_min", DEFAULT_DELIVERY_SETTINGS.base_prep_min),
    avg_stop_min: num("avg_stop_min", DEFAULT_DELIVERY_SETTINGS.avg_stop_min),
    peak_threshold: num("peak_threshold", DEFAULT_DELIVERY_SETTINGS.peak_threshold),
    max_wait_min: num("max_wait_min", DEFAULT_DELIVERY_SETTINGS.max_wait_min),
    normal_capacity_min: num("normal_capacity_min", DEFAULT_DELIVERY_SETTINGS.normal_capacity_min),
    normal_capacity_max: num("normal_capacity_max", DEFAULT_DELIVERY_SETTINGS.normal_capacity_max),
    peak_capacity_min: num("peak_capacity_min", DEFAULT_DELIVERY_SETTINGS.peak_capacity_min),
    peak_capacity_max: num("peak_capacity_max", DEFAULT_DELIVERY_SETTINGS.peak_capacity_max),
    manual_peak_mode: (d["manual_peak_mode"] == null ? DEFAULT_DELIVERY_SETTINGS.manual_peak_mode : Boolean(d["manual_peak_mode"])),
    delivery_enabled: d["delivery_enabled"] == null ? DEFAULT_DELIVERY_SETTINGS.delivery_enabled : Boolean(d["delivery_enabled"]),
    drivers_dial_up_only: d["drivers_dial_up_only"] == null ? DEFAULT_DELIVERY_SETTINGS.drivers_dial_up_only : Boolean(d["drivers_dial_up_only"]),
  };
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function isUFHAddress(address?: string | null): boolean {
  const value = (address ?? "").toLowerCase();
  return value.includes("ufh") || value.includes("university of fort hare") || value.includes("fort hare");
}

let mapsLoaderPromise: Promise<typeof google> | null = null;

function loadMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as unknown as { google?: typeof google };
  if (w.google?.maps) return Promise.resolve(w.google);
  if (mapsLoaderPromise) return mapsLoaderPromise;
  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
  if (!key) return Promise.reject(new Error("Google Maps key is not configured"));
  mapsLoaderPromise = new Promise((resolve, reject) => {
    (window as unknown as { __champsMapsCb?: () => void }).__champsMapsCb = () => resolve((window as unknown as { google: typeof google }).google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,routes&loading=async&callback=__champsMapsCb${channel ? `&channel=${channel}` : ""}`;
    s.async = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return mapsLoaderPromise;
}

export async function reverseGeocodeCoordinates(lat: number, lng: number): Promise<string> {
  const g = await loadMaps();
  const geocoder = new g.maps.Geocoder();
  const result = await new Promise<{ formattedAddress: string }>((resolve, reject) => {
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === "OK" && results?.[0]) resolve({ formattedAddress: results[0].formatted_address });
      else reject(new Error("Could not resolve your address"));
    });
  });
  return result.formattedAddress;
}

export async function getRoadDistanceKm(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<number> {
  if (typeof window === "undefined") throw new Error("Road distance requires a browser request");
  const g = await loadMaps();

  const originLocation = new g.maps.LatLng(origin.lat, origin.lng);
  const destinationLocation = new g.maps.LatLng(destination.lat, destination.lng);

  try {
    if (typeof (g.maps as typeof google.maps & { routes?: { RouteMatrix?: new () => any } }).routes?.RouteMatrix === "function") {
      const service = new (g.maps as typeof google.maps & { routes: { RouteMatrix: new () => any } }).routes.RouteMatrix();
      const response = await new Promise<{ distanceKm: number }>((resolve, reject) => {
        service.computeRouteMatrix(
          {
            origins: [originLocation],
            destinations: [destinationLocation],
            travelMode: g.maps.TravelMode.DRIVING,
            routingPreference: g.maps.RoutingPreference.FEWER_HIGHWAYS,
          },
          (result: any, status: string) => {
            const element = result?.rows?.[0]?.elements?.[0];
            if (status !== "OK" || element?.status !== "OK" || element?.distanceMeters == null) {
              reject(new Error("Could not calculate live delivery distance"));
              return;
            }
            resolve({ distanceKm: element.distanceMeters / 1000 });
          },
        );
      });
      return response.distanceKm;
    }

    if (typeof g.maps.DistanceMatrixService === "function") {
      const service = new g.maps.DistanceMatrixService();
      const response = await new Promise<{ distanceKm: number }>((resolve, reject) => {
        service.getDistanceMatrix(
          {
            origins: [originLocation],
            destinations: [destinationLocation],
            travelMode: g.maps.TravelMode.DRIVING,
            unitSystem: g.maps.UnitSystem.METRIC,
          },
          (result: any, status: string) => {
            const element = result?.rows?.[0]?.elements?.[0];
            if (status !== "OK" || element?.status !== "OK" || element?.distance?.value == null) {
              reject(new Error("Could not calculate live delivery distance"));
              return;
            }
            resolve({ distanceKm: element.distance.value / 1000 });
          },
        );
      });
      return response.distanceKm;
    }
  } catch (error) {
    console.warn("[delivery] falling back to straight-line distance", error);
  }

  return distanceKm(origin, destination);
}

export type DeliveryQuote =
  | { ok: true; distance_km: number; fee_cents: number }
  | { ok: false; distance_km: number; reason: string };

export type CartDeliveryEligibility = {
  allowed: boolean;
  reason?: string;
};

export const MAX_DELIVERY_ITEMS = 12;
const DELIVERY_DISALLOWED_ITEM_PATTERNS = [/milkshake/i, /sundae/i, /ice cream/i, /ice-cream/i, /cold drink/i, /soft serve/i, /bun(?:s)?/i];

export function getCartDeliveryEligibility(items: Array<{ name: string; variant?: string | null; unit_price_cents: number; quantity: number }>, subtotalCents: number): CartDeliveryEligibility {
  const combined = items
    .map((item) => `${item.name} ${item.variant ?? ""}`.toLowerCase())
    .join(" ");
  const totalItems = items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);

  if (totalItems > MAX_DELIVERY_ITEMS) {
    return { allowed: false, reason: `Delivery is unavailable for orders over ${MAX_DELIVERY_ITEMS} items because a motorbike can only carry so much.` };
  }
  if (items.some((item) => /sundae|ice cream|ice-cream|soft serve/i.test(`${item.name} ${item.variant ?? ""}`))) {
    return { allowed: false, reason: "Ice creams and sundaes are not available for delivery." };
  }
  if (subtotalCents < 4000) {
    return { allowed: false, reason: "Delivery requires a minimum order of R40." };
  }
  if (items.length > 0 && items.every((item) => DELIVERY_DISALLOWED_ITEM_PATTERNS.some((pattern) => pattern.test(`${item.name} ${item.variant ?? ""}`)))) {
    return { allowed: false, reason: "Delivery is not available for small item-only orders such as shakes, drinks, or buns." };
  }
  return { allowed: true };
}

export function quoteDelivery(distance: number, s: DeliverySettings, address?: string | null): DeliveryQuote {
  const km = Math.round(distance * 100) / 100;
  if (isUFHAddress(address)) {
    return { ok: true, distance_km: km, fee_cents: 3000 };
  }
  if (km > s.max_radius_km) {
    return { ok: false, distance_km: km, reason: "Delivery not available in your area" };
  }
  let fee = s.tier3_fee_cents;
  if (km <= s.tier1_max_km) fee = s.tier1_fee_cents;
  else if (km <= s.tier2_max_km) fee = s.tier2_fee_cents;
  else if (km <= s.tier3_max_km) fee = s.tier3_fee_cents;
  return { ok: true, distance_km: km, fee_cents: fee };
}

export function getBrowserLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export const DELIVERY_STATUS_FLOW = ["pending", "accepted", "handed_to_driver", "picked_up", "on_the_way", "delivered"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS_FLOW)[number] | "cancelled";
export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "handed_to_driver"
  | "picked_up"
  | "on_the_way"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export function resolveOrderDisplayStatus(orderStatus: string, deliveryStatus?: string | null): OrderStatus | null {
  if (orderStatus === "cancelled" || deliveryStatus === "cancelled") return "cancelled";
  if (orderStatus === "completed" || deliveryStatus === "delivered") return "completed";

  if (orderStatus === "pending" || orderStatus === "preparing" || orderStatus === "ready") {
    return orderStatus as OrderStatus;
  }

  if (orderStatus === "handed_to_driver" || deliveryStatus === "handed_to_driver") {
    return "handed_to_driver";
  }

  if (orderStatus === "picked_up" || deliveryStatus === "picked_up") {
    return "out_for_delivery";
  }

  if (orderStatus === "on_the_way" || orderStatus === "out_for_delivery" || deliveryStatus === "on_the_way" || deliveryStatus === "out_for_delivery") {
    return "out_for_delivery";
  }

  if (deliveryStatus === "pending" || deliveryStatus === "accepted") return "ready";
  return null;
}

export type PersistedOrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "handed_to_driver"
  | "picked_up"
  | "on_the_way"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export function getOrderStatusForDeliveryStatus(status: string): PersistedOrderStatus | null {
  switch (status as DeliveryStatus) {
    case "pending":
      return "pending";
    case "accepted":
      return "ready";
    case "handed_to_driver":
      return "handed_to_driver";
    case "picked_up":
      return "picked_up";
    case "on_the_way":
      return "on_the_way";
    case "delivered":
      return "completed";
    default:
      return null;
  }
}

export function getDeliveryStatusForOrderStatus(status: string): DeliveryStatus | null {
  switch (status) {
    case "handed_to_driver":
      return "handed_to_driver";
    case "picked_up":
      return "picked_up";
    case "on_the_way":
      return "on_the_way";
    case "out_for_delivery":
      return "on_the_way";
    case "completed":
      return "delivered";
    default:
      return null;
  }
}

export const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "Received",
  accepted: "Accepted",
  handed_to_driver: "Handed to driver",
  picked_up: "Picked up",
  on_the_way: "Out for delivery",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export type DeliveryMode = "normal" | "peak";

export function computeMode(activeCount: number, s: DeliverySettings): DeliveryMode {
  if (s.manual_peak_mode) return "peak";
  return activeCount >= s.peak_threshold ? "peak" : "normal";
}

export function capacityForMode(mode: DeliveryMode, s: DeliverySettings): { min: number; max: number } {
  return mode === "peak"
    ? { min: s.peak_capacity_min, max: s.peak_capacity_max }
    : { min: s.normal_capacity_min, max: s.normal_capacity_max };
}

/**
 * ETA range in minutes for a customer whose delivery sits at `position` in the driver's queue (1-based).
 * Formula: base + position * avg_stop (with a +/- window around it).
 */
export function computeEtaRange(
  position: number,
  s: DeliverySettings,
  mode: DeliveryMode = "normal",
  distanceKm?: number,
): { min: number; max: number } {
  const pos = Math.max(1, position);
  const distanceBoost = distanceKm != null ? Math.max(0, Math.round(distanceKm * 2.5)) : 0;
  const center = s.base_prep_min + pos * s.avg_stop_min + distanceBoost;
  const spread = mode === "peak" ? 10 : 7;
  return { min: Math.max(15, center - spread), max: center + spread };
}

export async function fetchActiveDeliveryCount(): Promise<number> {
  const { count } = await supabase
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .neq("status", "delivered");
  return count ?? 0;
}

export async function fetchOnlineDriverCount(): Promise<number> {
  const { data, error } = await supabase.rpc("online_drivers_count");
  if (error) return 0;
  return Number(data ?? 0);
}

export async function triggerAutoAssign(): Promise<number> {
  const { data, error } = await supabase.rpc("auto_assign_pending_deliveries");
  if (error) return 0;
  return Number(data ?? 0);
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  not_paid: "Not paid",
  pending: "Awaiting driver confirmation",
  paid: "Paid",
};


