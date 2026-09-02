import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function Loader({ visible = true }: { visible?: boolean }) {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      const id = window.setTimeout(() => setIsLeaving(true), 250);
      return () => window.clearTimeout(id);
    }
    setIsLeaving(false);
  }, [visible]);

  if (!visible && isLeaving) return null;

  return (
    <div className={cn("fixed inset-0 z-[999] flex items-center justify-center bg-background text-foreground backdrop-blur-sm transition-opacity duration-300", visible ? "opacity-100" : "opacity-0") }>
      <div className="flex flex-col items-center text-center">
        <img src="/images/champs/champs-logo.png" alt="Champs Chicken" className="h-14 w-14 animate-float sm:h-16 sm:w-16" />
        <div className="mt-3 text-xs font-semibold uppercase tracking-[0.3em] text-brand">Loading…</div>
      </div>
    </div>
  );
}

export function MenuPageSkeleton() {
  return (
    <div className="min-h-screen pb-24">
      <div className="h-16 animate-pulse border-b border-border bg-muted/50" />
      <div className="mx-auto max-w-lg px-4 py-4 space-y-8">
        {[0, 1, 2].map((section) => (
          <div key={section} className="space-y-3">
            <div className="h-7 w-32 animate-pulse rounded-full bg-muted" />
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded-full bg-muted/70" />
                  <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DriverPageSkeleton() {
  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <div className="border-b bg-background p-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="h-8 w-24 animate-pulse rounded-full bg-muted" />
          <div className="flex gap-2">
            <div className="h-8 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {[0, 1].map((card) => (
          <div key={card} className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="h-4 w-24 animate-pulse rounded-full bg-muted" />
            <div className="mt-3 h-5 w-3/4 animate-pulse rounded-full bg-muted" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-muted/70" />
            <div className="mt-4 h-10 animate-pulse rounded-xl bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountPageSkeleton() {
  return (
    <div className="min-h-screen pb-24">
      <div className="h-16 animate-pulse border-b border-border bg-muted/50" />
      <div className="mx-auto max-w-lg space-y-6 px-4 py-4">
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        <div className="space-y-3">
          <div className="h-6 w-28 animate-pulse rounded-full bg-muted" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-20 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
