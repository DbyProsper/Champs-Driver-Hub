import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, Navigation, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { loadGoogleMaps } from "@/components/AddressAutocomplete";
import { supabase } from "@/integrations/supabase/client";
import { fullNavigationUrl, straightLineDistanceMeters, type NavigationPoint } from "@/lib/driver-navigation";

type DriverDeliveryMapProps = {
  driverId: string;
  orderNumber: string;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationAddress: string | null;
  trackingActive: boolean;
  driverOnline: boolean;
};

type RouteInfo = { distance: string; duration: string };

const MARKER_UPDATE_MS = 5_000;
const LOCATION_WRITE_MS = 15_000;
const LOCATION_WRITE_DISTANCE_METRES = 75;
const ROUTE_REFRESH_MS = 60_000;
const ROUTE_REFRESH_DISTANCE_METRES = 250;

export function DriverDeliveryMap({
  driverId,
  orderNumber,
  destinationLat,
  destinationLng,
  destinationAddress,
  trackingActive,
  driverOnline,
}: DriverDeliveryMapProps) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapInitializingRef = useRef(false);
  const mapsRef = useRef<typeof google | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const customerMarkerRef = useRef<google.maps.Marker | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const currentLocationRef = useRef<NavigationPoint | null>(null);
  const destinationRef = useRef<NavigationPoint | null>(null);
  const lastMarkerAtRef = useRef(0);
  const lastWrittenLocationRef = useRef<NavigationPoint | null>(null);
  const lastWriteAtRef = useRef(0);
  const writeBusyRef = useRef(false);
  const lastRouteOriginRef = useRef<NavigationPoint | null>(null);
  const lastRouteAtRef = useRef(0);
  const geocodedAddressRef = useRef<string | null>(null);
  const locationErrorShownRef = useRef(false);

  const [driverLocation, setDriverLocation] = useState<NavigationPoint | null>(null);
  const [destination, setDestination] = useState<NavigationPoint | null>(
    destinationLat != null && destinationLng != null ? { lat: destinationLat, lng: destinationLng } : null,
  );
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    const next = destinationLat != null && destinationLng != null ? { lat: destinationLat, lng: destinationLng } : null;
    destinationRef.current = next;
    setDestination(next);
    if (next) geocodedAddressRef.current = null;
  }, [destinationLat, destinationLng]);

  const drawRoute = useCallback(async (force = false) => {
    const maps = mapsRef.current;
    const origin = currentLocationRef.current;
    const target = destinationRef.current;
    if (!maps || !mapRef.current || !origin || !target) return;
    const now = Date.now();
    const moved = lastRouteOriginRef.current ? straightLineDistanceMeters(lastRouteOriginRef.current, origin) : Infinity;
    if (!force && lastRouteOriginRef.current && (now - lastRouteAtRef.current < ROUTE_REFRESH_MS || moved < ROUTE_REFRESH_DISTANCE_METRES)) return;
    setRouteBusy(true);
    setRouteError(null);
    const directions = new maps.maps.DirectionsService();
    try {
      const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
        directions.route(
          { origin, destination: target, travelMode: maps.maps.TravelMode.DRIVING },
          (response, status) => status === "OK" && response ? resolve(response) : reject(new Error(status)),
        );
      });
      rendererRef.current?.setDirections(result);
      const leg = result.routes[0]?.legs[0];
      setRouteInfo({ distance: leg?.distance?.text ?? "Unavailable", duration: leg?.duration?.text ?? "Unavailable" });
      lastRouteOriginRef.current = origin;
      lastRouteAtRef.current = now;
    } catch {
      setRouteInfo(null);
      setRouteError("Route information is temporarily unavailable.");
    } finally {
      setRouteBusy(false);
    }
  }, []);

  const initializeMap = useCallback(async () => {
    if (!trackingActive || !driverOnline || !mapNode.current || !driverLocation || !destination || mapRef.current || mapInitializingRef.current) return;
    mapInitializingRef.current = true;
    try {
      const maps = await loadGoogleMaps() as typeof google;
      if (!mapNode.current) return;
      mapsRef.current = maps;
      destinationRef.current = destination;
      currentLocationRef.current = driverLocation;
      const map = new maps.maps.Map(mapNode.current, {
        center: driverLocation,
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;
      driverMarkerRef.current = new maps.maps.Marker({ map, position: driverLocation, title: "Your current position", label: "D" });
      customerMarkerRef.current = new maps.maps.Marker({ map, position: destination, title: "Customer destination", label: "C" });
      rendererRef.current = new maps.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        preserveViewport: false,
        polylineOptions: { strokeColor: "#E21B23", strokeOpacity: 0.9, strokeWeight: 5 },
      });
      await drawRoute(true);
    } catch {
      setRouteError("Google Maps is temporarily unavailable. Use full navigation below.");
    } finally {
      mapInitializingRef.current = false;
    }
  }, [destination, drawRoute, driverLocation, driverOnline, trackingActive]);

  useEffect(() => {
    if (!trackingActive || destination || !destinationAddress || geocodedAddressRef.current === destinationAddress) return;
    geocodedAddressRef.current = destinationAddress;
    void loadGoogleMaps()
      .then((maps: typeof google) => new Promise<NavigationPoint>((resolve, reject) => {
        new maps.maps.Geocoder().geocode({ address: destinationAddress }, (results, status) => {
          const point = results?.[0]?.geometry.location;
          if (status === "OK" && point) resolve({ lat: point.lat(), lng: point.lng() });
          else reject(new Error(status));
        });
      }))
      .then((point) => {
        destinationRef.current = point;
        setDestination(point);
      })
      .catch(() => setRouteError("Customer coordinates are unavailable. Use full navigation below."));
  }, [destination, destinationAddress, trackingActive]);

  useEffect(() => {
    if (!trackingActive || destination || destinationAddress) return;
    setRouteError("Customer coordinates are unavailable. Use the customer address or contact them for directions.");
  }, [destination, destinationAddress, trackingActive]);

  useEffect(() => {
    if (!trackingActive || !driverOnline) return;
    if (!navigator.geolocation) {
      setLocationError("This browser does not support precise location. Use full navigation below.");
      return;
    }
    setLocationError(null);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const previousPoint = currentLocationRef.current;
        currentLocationRef.current = point;
        const now = Date.now();
        if (!previousPoint || now - lastMarkerAtRef.current >= MARKER_UPDATE_MS) {
          lastMarkerAtRef.current = now;
          setDriverLocation(point);
          driverMarkerRef.current?.setPosition(point);
          if (mapRef.current && !lastRouteOriginRef.current) mapRef.current.panTo(point);
          void drawRoute();
        }

        const movedSinceWrite = lastWrittenLocationRef.current
          ? straightLineDistanceMeters(lastWrittenLocationRef.current, point)
          : Infinity;
        if (!writeBusyRef.current && (now - lastWriteAtRef.current >= LOCATION_WRITE_MS || movedSinceWrite >= LOCATION_WRITE_DISTANCE_METRES)) {
          writeBusyRef.current = true;
          void (async () => {
            try {
              const { error } = await supabase
                .from("driver_locations")
                .upsert({ driver_id: driverId, latitude: point.lat, longitude: point.lng, updated_at: new Date(now).toISOString() }, { onConflict: "driver_id" });
              if (!error) {
                lastWriteAtRef.current = now;
                lastWrittenLocationRef.current = point;
              } else if (!locationErrorShownRef.current) {
                locationErrorShownRef.current = true;
                toast.error("Live location could not be saved. The route will continue on this device.");
              }
            } finally {
              writeBusyRef.current = false;
            }
          })();
        }
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Location access is required for embedded navigation. You can still use full navigation."
          : error.code === error.TIMEOUT
          ? "Your GPS location timed out. Try again or use full navigation."
          : "Your current location is unavailable. Try again or use full navigation.";
        setLocationError(message);
        if (!locationErrorShownRef.current) {
          locationErrorShownRef.current = true;
          toast.error(message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [drawRoute, driverId, driverOnline, trackingActive]);

  useEffect(() => { void initializeMap(); }, [initializeMap]);

  useEffect(() => {
    if (!mapRef.current || !destination) return;
    destinationRef.current = destination;
    customerMarkerRef.current?.setPosition(destination);
    void drawRoute(true);
  }, [destination, drawRoute]);

  useEffect(() => {
    if (trackingActive && driverOnline) return;
    rendererRef.current?.setMap(null);
    driverMarkerRef.current?.setMap(null);
    customerMarkerRef.current?.setMap(null);
    rendererRef.current = null;
    driverMarkerRef.current = null;
    customerMarkerRef.current = null;
    mapRef.current = null;
    lastRouteOriginRef.current = null;
    lastRouteAtRef.current = 0;
  }, [driverOnline, trackingActive]);

  useEffect(() => () => {
    if (watchIdRef.current != null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(watchIdRef.current);
    rendererRef.current?.setMap(null);
    driverMarkerRef.current?.setMap(null);
    customerMarkerRef.current?.setMap(null);
    mapRef.current = null;
  }, []);

  const navigationHref = useMemo(
    () => fullNavigationUrl(destination, destinationAddress, driverLocation),
    [destination, destinationAddress, driverLocation],
  );

  return (
    <section className="rounded-2xl border bg-muted/20 p-3" aria-label={`Delivery route for order ${orderNumber}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-brand">Delivery route</div>
        {trackingActive && driverLocation && destination && (
          <button type="button" disabled={routeBusy} onClick={() => void drawRoute(true)} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-[10px] font-bold disabled:opacity-60">
            {routeBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh route
          </button>
        )}
      </div>

      {!trackingActive ? (
        <div className="mt-2 rounded-xl border border-dashed bg-background p-4 text-center text-xs text-muted-foreground">Start delivery to activate the embedded live route.</div>
      ) : !driverOnline ? (
        <div className="mt-2 rounded-xl border border-dashed bg-background p-4 text-center text-xs text-muted-foreground">Go online to use live location tracking.</div>
      ) : (
        <>
          <div className="relative mt-2 overflow-hidden rounded-xl border bg-muted">
            <div ref={mapNode} className="h-64 w-full sm:h-72" />
            {!driverLocation && !locationError && <div className="absolute inset-0 grid place-items-center bg-background/80"><div className="inline-flex items-center gap-2 text-xs font-semibold"><Loader2 className="h-4 w-4 animate-spin text-brand" /> Getting your precise location…</div></div>}
          </div>
          {locationError && <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-900">{locationError}</div>}
          {routeError && <div className="mt-2 rounded-xl border p-3 text-xs text-muted-foreground">{routeError}</div>}
          {routeInfo && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border bg-background p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Distance</div><div className="font-bold">{routeInfo.distance}</div></div>
              <div className="rounded-xl border bg-background p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA</div><div className="font-bold">Approximately {routeInfo.duration}</div></div>
            </div>
          )}
          {driverLocation && destination && <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground"><MapPin className="h-3.5 w-3.5 text-brand" /> Driver position → road route → customer destination</div>}
        </>
      )}

      {navigationHref && (
        <a href={navigationHref} target="_blank" rel="noreferrer" className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border bg-background px-3 py-3 text-sm font-bold">
          <Navigation className="h-4 w-4" /> Open Full Navigation
        </a>
      )}
    </section>
  );
}
