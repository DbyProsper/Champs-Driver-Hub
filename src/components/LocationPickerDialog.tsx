import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import { loadGoogleMaps } from "@/components/AddressAutocomplete";

type Location = { address: string; lat: number; lng: number };

export function LocationPickerDialog({ open, initial, fallback, onClose, onConfirm }: { open: boolean; initial?: { lat: number; lng: number } | null; fallback?: { lat: number; lng: number } | null; onClose: () => void; onConfirm: (location: Location) => void }) {
  const mapNode = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Location | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !mapNode.current) return;
    let active = true;
    let listener: { remove: () => void } | null = null;
    setLoading(true);
    void loadGoogleMaps().then((google) => {
      if (!active || !mapNode.current) return;
      const center = initial ?? fallback ?? { lat: -32.7864, lng: 26.8344 };
      const map = new google.maps.Map(mapNode.current, { center, zoom: initial ? 17 : 14, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      const marker = new google.maps.Marker({ map, position: center });
      const geocoder = new google.maps.Geocoder();
      const choose = (lat: number, lng: number) => {
        marker.setPosition({ lat, lng });
        map.panTo({ lat, lng });
        geocoder.geocode({ location: { lat, lng } }, (results: any[], status: string) => {
          const address = status === "OK" && results?.[0]?.formatted_address ? results[0].formatted_address : `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
          if (active) setSelected({ address, lat, lng });
        });
      };
      choose(center.lat, center.lng);
      listener = map.addListener("click", (event: any) => {
        if (event.latLng) choose(event.latLng.lat(), event.latLng.lng());
      });
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { active = false; listener?.remove(); };
  }, [open, initial?.lat, initial?.lng, fallback?.lat, fallback?.lng]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Choose location on map" onClick={onClose}>
    <div className="w-full max-w-lg rounded-3xl border bg-background p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-2xl text-brand">Pin your location</h2><p className="text-xs text-muted-foreground">Tap the map exactly where the driver should meet you.</p></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" aria-label="Close map"><X className="h-4 w-4" /></button></div>
      <div className="relative mt-3 overflow-hidden rounded-2xl border"><div ref={mapNode} className="h-[52dvh] min-h-72 w-full" />{loading && <div className="absolute inset-0 grid place-items-center bg-background/70"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>}</div>
      <div className="mt-3 rounded-xl bg-muted/50 p-3 text-xs"><div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>{selected?.address ?? "Tap the map to choose a location"}</span></div></div>
      <button type="button" disabled={!selected} onClick={() => selected && onConfirm(selected)} className="mt-3 w-full rounded-full bg-brand px-4 py-3 text-sm font-bold text-brand-foreground disabled:opacity-50">Use this location</button>
    </div>
  </div>;
}
