import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Branch = {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  postal_code: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  latitude: number | null;
  longitude: number | null;
  opens_at: string;
  closes_at: string;
};

type BranchCtx = {
  branches: Branch[];
  active: Branch | null;
  setActive: (b: Branch) => void;
  ready: boolean;
  needsPicker: boolean;
  dismissPicker: () => void;
};

const Ctx = createContext<BranchCtx | null>(null);
const KEY = "champs-branch-v1";

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [active, setActiveState] = useState<Branch | null>(null);
  const [ready, setReady] = useState(false);
  const [needsPicker, setNeedsPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("branches")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (cancelled) return;
      const list = (data as Branch[]) ?? [];
      setBranches(list);

      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KEY);
      } catch {}
      const savedBranch = saved ? list.find((b) => b.id === saved) : null;
      if (savedBranch) {
        setActiveState(savedBranch);
        setReady(true);
        return;
      }
      // Try geolocation
      if (typeof navigator !== "undefined" && navigator.geolocation && list.length > 0) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const nearest = [...list]
              .filter((b) => b.latitude != null && b.longitude != null)
              .map((b) => ({
                b,
                d: distanceKm(
                  { lat: pos.coords.latitude, lng: pos.coords.longitude },
                  { lat: b.latitude!, lng: b.longitude! },
                ),
              }))
              .sort((x, y) => x.d - y.d)[0];
            if (nearest) {
              setActiveState(nearest.b);
              try { localStorage.setItem(KEY, nearest.b.id); } catch {}
            } else {
              setActiveState(list[0]);
            }
            setNeedsPicker(true); // still let them confirm/change
            setReady(true);
          },
          () => {
            setActiveState(list[0]);
            setNeedsPicker(true);
            setReady(true);
          },
          { timeout: 4000 },
        );
      } else {
        setActiveState(list[0] ?? null);
        setNeedsPicker(list.length > 1);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setActive = useCallback((b: Branch) => {
    setActiveState(b);
    try { localStorage.setItem(KEY, b.id); } catch {}
    setNeedsPicker(false);
  }, []);

  const dismissPicker = useCallback(() => setNeedsPicker(false), []);

  const value = useMemo<BranchCtx>(
    () => ({ branches, active, setActive, ready, needsPicker, dismissPicker }),
    [branches, active, setActive, ready, needsPicker, dismissPicker],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranch() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
