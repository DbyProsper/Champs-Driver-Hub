import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { loadGoogleMaps } from "@/components/AddressAutocomplete";
import { supabase } from "@/integrations/supabase/client";
import { straightLineDistanceMeters, type NavigationPoint } from "@/lib/driver-navigation";

type CustomerLiveDeliveryMapProps = {
  orderId: string;
  orderNumber: string;
  driverId: string;
  destinationLat: number | null;
  destinationLng: number | null;
};

type RouteInfo = { distance: string; duration: string };
type ConnectionState = "connecting" | "connected" | "unavailable";
type LocationRow = {
  driver_id: string;
  latitude: number;
  longitude: number;
  updated_at: string;
};

const STALE_LOCATION_MS = 45_000;
const ROUTE_REFRESH_MS = 90_000;
const ROUTE_REFRESH_DISTANCE_METRES = 250;
const MARKER_ANIMATION_MS = 1_200;

export function CustomerLiveDeliveryMap({
  orderId,
  orderNumber,
  driverId,
  destinationLat,
  destinationLng,
}: CustomerLiveDeliveryMapProps) {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapsRef = useRef<typeof google | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const customerMarkerRef = useRef<google.maps.Marker | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const locationRef = useRef<NavigationPoint | null>(null);
  const animatedLocationRef = useRef<NavigationPoint | null>(null);
  const lastRouteOriginRef = useRef<NavigationPoint | null>(null);
  const lastRouteAtRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const mapInitializingRef = useRef(false);

  const destination = useMemo(
    () => destinationLat != null && destinationLng != null ? { lat: destinationLat, lng: destinationLng } : null,
    [destinationLat, destinationLng],
  );
  const destinationRef = useRef<NavigationPoint | null>(destination);

  const [driverLocation, setDriverLocation] = useState<NavigationPoint | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [mapError, setMapError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [clock, setClock] = useState(Date.now());

  const acceptLocation = useCallback((row: Partial<LocationRow> | null | undefined) => {
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const next = { lat: latitude, lng: longitude };
    locationRef.current = next;
    setDriverLocation(next);
    const parsedUpdatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : Date.now();
    setLastUpdatedAt(Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now());
  }, []);

  const drawRoute = useCallback(async (force = false) => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    const origin = locationRef.current;
    const target = destinationRef.current;
    if (!maps || !map || !origin || !target) return;

    const now = Date.now();
    const moved = lastRouteOriginRef.current
      ? straightLineDistanceMeters(lastRouteOriginRef.current, origin)
      : Infinity;
    if (!force && lastRouteOriginRef.current && now - lastRouteAtRef.current < ROUTE_REFRESH_MS && moved < ROUTE_REFRESH_DISTANCE_METRES) return;

    try {
      const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
        new maps.maps.DirectionsService().route(
          { origin, destination: target, travelMode: maps.maps.TravelMode.DRIVING },
          (response, status) => status === "OK" && response ? resolve(response) : reject(new Error(status)),
        );
      });
      rendererRef.current?.setDirections(result);
      const leg = result.routes[0]?.legs[0];
      setRouteInfo({
        distance: leg?.distance?.text ?? "Unavailable",
        duration: leg?.duration?.text ?? "Unavailable",
      });
      setRouteError(null);
      lastRouteOriginRef.current = origin;
      lastRouteAtRef.current = now;
    } catch {
      setRouteError("Route information is temporarily unavailable.");
    }
  }, []);

  const animateDriverMarker = useCallback((next: NavigationPoint) => {
    const marker = driverMarkerRef.current;
    if (!marker) return;
    if (animationFrameRef.current != null) cancelAnimationFrame(animationFrameRef.current);

    const start = animatedLocationRef.current ?? next;
    const startedAt = performance.now();
    const step = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / MARKER_ANIMATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      const point = {
        lat: start.lat + (next.lat - start.lat) * eased,
        lng: start.lng + (next.lng - start.lng) * eased,
      };
      animatedLocationRef.current = point;
      marker.setPosition(point);
      if (progress < 1) animationFrameRef.current = requestAnimationFrame(step);
      else animationFrameRef.current = null;
    };
    animationFrameRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);

  useEffect(() => {
    let active = true;
    setConnectionState("connecting");
    setDriverLocation(null);
    setLastUpdatedAt(null);
    locationRef.current = null;

    const channel = supabase
      .channel(`delivery-tracking:${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations", filter: `driver_id=eq.${driverId}` },
        (payload) => acceptLocation(payload.new as Partial<LocationRow>),
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setConnectionState("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConnectionState("unavailable");
      });

    void supabase
      .from("driver_locations")
      .select("driver_id, latitude, longitude, updated_at")
      .eq("driver_id", driverId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setConnectionState("unavailable");
          return;
        }
        acceptLocation(data);
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [acceptLocation, driverId, orderId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!destination || !mapNodeRef.current || mapRef.current || mapInitializingRef.current) return;
    let active = true;
    mapInitializingRef.current = true;
    void loadGoogleMaps()
      .then((maps: typeof google) => {
        if (!active || !mapNodeRef.current) return;
        mapsRef.current = maps;
        const map = new maps.maps.Map(mapNodeRef.current, {
          center: destination,
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;
        customerMarkerRef.current = new maps.maps.Marker({
          map,
          position: destination,
          title: "Your delivery location",
          label: "C",
        });
        rendererRef.current = new maps.maps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          preserveViewport: false,
          polylineOptions: { strokeColor: "#E21B23", strokeOpacity: 0.9, strokeWeight: 5 },
        });
        if (locationRef.current) {
          driverMarkerRef.current = new maps.maps.Marker({
            map,
            position: locationRef.current,
            title: "Your driver",
            label: "D",
          });
          animatedLocationRef.current = locationRef.current;
          void drawRoute(true);
        }
      })
      .catch(() => {
        if (active) setMapError("Live map is temporarily unavailable.");
      })
      .finally(() => {
        mapInitializingRef.current = false;
      });
    return () => {
      active = false;
    };
  }, [destination, drawRoute]);

  useEffect(() => {
    if (!driverLocation || !mapRef.current || !mapsRef.current) return;
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new mapsRef.current.maps.Marker({
        map: mapRef.current,
        position: driverLocation,
        title: "Your driver",
        label: "D",
      });
      animatedLocationRef.current = driverLocation;
      mapRef.current.panTo(driverLocation);
      void drawRoute(true);
      return;
    }
    animateDriverMarker(driverLocation);
    void drawRoute();
  }, [animateDriverMarker, drawRoute, driverLocation]);

  useEffect(() => () => {
    if (animationFrameRef.current != null) cancelAnimationFrame(animationFrameRef.current);
    rendererRef.current?.setMap(null);
    driverMarkerRef.current?.setMap(null);
    customerMarkerRef.current?.setMap(null);
    rendererRef.current = null;
    driverMarkerRef.current = null;
    customerMarkerRef.current = null;
    mapRef.current = null;
    locationRef.current = null;
    animatedLocationRef.current = null;
  }, []);

  if (!destination) {
    return <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Live map is temporarily unavailable.</div>;
  }

  const ageMs = lastUpdatedAt == null ? null : Math.max(0, clock - lastUpdatedAt);
  const stale = ageMs != null && ageMs >= STALE_LOCATION_MS;
  const nearby = driverLocation ? straightLineDistanceMeters(driverLocation, destination) <= 250 : false;
  const updatedText = ageMs == null
    ? null
    : ageMs < 10_000
    ? "Updated just now"
    : `Updated ${Math.max(1, Math.round(ageMs / 1_000))} seconds ago`;

  return (
    <section className="rounded-2xl border bg-muted/20 p-3" aria-label={`Live delivery tracking for order ${orderNumber}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-brand">Live delivery</div>
        <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${connectionState === "connected" ? "bg-green-500" : connectionState === "connecting" ? "bg-amber-400" : "bg-muted-foreground"}`} />
          {connectionState === "connected" ? "Live" : connectionState === "connecting" ? "Connecting" : "Unavailable"}
        </div>
      </div>

      <div className="relative mt-2 overflow-hidden rounded-xl border bg-muted">
        <div ref={mapNodeRef} className="h-64 w-full sm:h-72" />
        {!driverLocation && !mapError && (
          <div className="absolute inset-0 grid place-items-center bg-background/80 p-4 text-center">
            <div className="inline-flex items-center gap-2 text-xs font-semibold"><Loader2 className="h-4 w-4 animate-spin text-brand" /> Waiting for driver&apos;s live location…</div>
          </div>
        )}
      </div>

      {mapError && <div className="mt-2 rounded-xl border p-3 text-xs text-muted-foreground">{mapError}</div>}
      {connectionState === "unavailable" && <div className="mt-2 rounded-xl border p-3 text-xs text-muted-foreground">Live tracking is temporarily unavailable.</div>}
      {stale && <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-900">Driver location has not updated recently.</div>}
      {routeError && <div className="mt-2 rounded-xl border p-3 text-xs text-muted-foreground">{routeError}</div>}

      {routeInfo && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl border bg-background p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Remaining distance</div><div className="font-bold">{routeInfo.distance} away</div></div>
          <div className="rounded-xl border bg-background p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated arrival</div><div className="font-bold">Approximately {routeInfo.duration}</div></div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-brand" /> Driver → your delivery location</span>
        {updatedText && <span>{updatedText}</span>}
      </div>
      {nearby && <div className="mt-2 rounded-xl bg-brand/10 px-3 py-2 text-xs font-bold text-brand">Your driver is nearby</div>}
    </section>
  );
}
