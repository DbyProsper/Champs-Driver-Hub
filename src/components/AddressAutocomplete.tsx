import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

type Suggestion = {
  placePrediction?: any;
  placeId: string;
  text: string;
  secondary?: string;
};

let mapsLoaderPromise: Promise<any> | null = null;

function loadMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as Window & typeof globalThis & { google?: any; __champsMapsCb?: () => void };
  if (w.google?.maps) return Promise.resolve(w.google);
  if (mapsLoaderPromise) return mapsLoaderPromise;
  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
  if (!key) return Promise.reject(new Error("Google Maps key missing"));
  mapsLoaderPromise = new Promise((resolve, reject) => {
    w.__champsMapsCb = () => resolve((window as Window & typeof globalThis & { google?: any }).google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,routes&loading=async&callback=__champsMapsCb${channel ? `&channel=${channel}` : ""}`;
    s.async = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return mapsLoaderPromise;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Delivery address",
  bias,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (result: { address: string; lat: number; lng: number }) => void;
  placeholder?: string;
  bias?: { lat: number; lng: number };
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef<any>(null);
  const debRef = useRef<number | null>(null);
  const selectedValueRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    loadMaps().catch(() => {});
  }, []);

  useEffect(() => {
    if (debRef.current) window.clearTimeout(debRef.current);
    if (selectedValueRef.current === value) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    if (!value || value.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debRef.current = window.setTimeout(async () => {
      const requestId = ++requestRef.current;
      try {
        setLoading(true);
        const g = await loadMaps();
        const places = (await g.maps.importLibrary("places")) as any;
        if (!tokenRef.current) tokenRef.current = new places.AutocompleteSessionToken();

        const request: any = {
          input: value.trim(),
          includedRegionCodes: ["za"],
          sessionToken: tokenRef.current,
        };
        if (bias) {
          request.locationBias = { center: { lat: bias.lat, lng: bias.lng }, radius: 20000 };
        }

        const predictionResults = await new Promise<any[]>((resolve) => {
          const current = (places as any).AutocompleteSuggestion?.fetchAutocompleteSuggestions
            ? (places as any).AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
            : null;

          if (current && typeof (current as Promise<any>).then === "function") {
            (current as Promise<any>)
              .then((response: any) => {
                const suggestionsList = Array.isArray(response?.suggestions) ? response.suggestions : [];
                resolve(suggestionsList);
              })
              .catch(() => resolve([]));
          } else {
            resolve([]);
          }
        });

        const list: Suggestion[] = predictionResults
          .map((p: any) => {
            if (!p) return null;
            return {
              placePrediction: p,
              placeId: p.placePrediction?.placeId ?? p.place_id ?? p.placeId ?? "",
              text: p.placePrediction?.text?.toString() ?? p.description ?? p.text ?? "",
              secondary: p.placePrediction?.structuredFormatting?.secondaryText ?? p.secondary ?? undefined,
            };
          })
          .filter(Boolean) as Suggestion[];
        if (requestId !== requestRef.current || selectedValueRef.current === value) return;
        setSuggestions(list);
        setOpen(list.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debRef.current) window.clearTimeout(debRef.current);
    };
  }, [value, bias?.lat, bias?.lng]);

  async function pick(s: Suggestion) {
    requestRef.current += 1;
    setOpen(false);
    setSuggestions([]);
    try {
      const g = await loadMaps();
      const places = (await g.maps.importLibrary("places")) as any;
      const placeId = s.placeId;
      if (!placeId) throw new Error("No place selected");

      const place = new places.Place({ id: placeId });
      await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
      const label = place.displayName ?? place.formattedAddress ?? `${s.text}${s.secondary ? ` · ${s.secondary}` : ""}`;
      const loc = place.location;
      // Update the input value first, then notify parent of a confirmed selection.
      selectedValueRef.current = label;
      onChange(label);
      if (loc) onSelect({ address: label, lat: loc.lat(), lng: loc.lng() });
      tokenRef.current = null;
    } catch {
      const fallback = `${s.text}${s.secondary ? ` · ${s.secondary}` : ""}`;
      selectedValueRef.current = fallback;
      onChange(fallback);
      onSelect({ address: fallback, lat: bias?.lat ?? 0, lng: bias?.lng ?? 0 });
    }
  }

  return (
    <div className="relative">
      <input
        className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          if (e.target.value !== selectedValueRef.current) selectedValueRef.current = null;
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 200)}
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border bg-card shadow-lg max-h-72 overflow-auto">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              className="w-full flex items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent border-b last:border-b-0"
            >
              <MapPin className="h-4 w-4 mt-0.5 text-brand shrink-0" />
              <span className="min-w-0">
                <span className="block font-semibold truncate">{s.text}</span>
                {s.secondary && <span className="block text-xs text-muted-foreground truncate">{s.secondary}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
