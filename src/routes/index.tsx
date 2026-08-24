import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MapPin, Clock, ChevronRight, Flame, Sparkles, Phone } from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { useBranch } from "@/lib/branch";
import { activePromotionsQuery } from "@/lib/user-queries";
import { formatZAR } from "@/lib/format";
import { FALLBACK_SETTINGS, imageSrcFor, siteContentQuery } from "@/lib/site-content";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Champs Chicken — Fried Chicken Since 1995 | Dikeni & Fort Beaufort" },
      { name: "description", content: "Order Champs Chicken online for pickup or delivery. Chicken, chips, burgers, fish, combos & shakes. Now serving Dikeni and Fort Beaufort." },
    ],
  }),
  component: Home,
});

function Home() {
  const { active } = useBranch();
  const { data: promos = [] } = useQuery(activePromotionsQuery);
  const { data: content } = useQuery(siteContentQuery);
  const queryClient = useQueryClient();
  const settings = content?.settings ?? FALLBACK_SETTINGS;
  const media = content?.media ?? [];
  const heroSrc = imageSrcFor(settings.hero_image_key, media, "girls-lunch");
  const headline = useTypewriter([settings.hero_line_one, settings.hero_line_two], { typeMs: 65, holdMs: 1600, eraseMs: 35 });
  const heroBody = settings.hero_body.replace("your town", active?.city ?? "your town");

  useEffect(() => {
    const channel = supabase.channel("homepage-appearance")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, () => void queryClient.invalidateQueries({ queryKey: ["site-content"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "media_assets" }, () => void queryClient.invalidateQueries({ queryKey: ["site-content"] }))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  return (
    <div className="min-h-screen pb-24">
      <Header subtitle={active ? active.city + " · Since 1995" : "Since 1995"} />

      {/* Hero with girls-lunch photo blended into brand dark. Mobile-first sizing + focal point that keeps faces in frame. */}
      <section className="relative overflow-hidden text-white min-h-[68vh] sm:min-h-[520px] flex">
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: `url(${heroSrc})`, backgroundPosition: `${settings.hero_focus_x}% ${settings.hero_focus_y}%` }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a0708]/95 via-[#2b0a0c]/80 to-brand/60 mix-blend-multiply" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,transparent_20%,rgba(0,0,0,0.75)_85%)]" aria-hidden />

        <div className="relative mx-auto flex w-full max-w-lg flex-col justify-end px-5 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-white/90 text-[11px] font-bold uppercase tracking-widest">
            <Flame className="h-3.5 w-3.5 text-brand" /> {settings.hero_eyebrow}
          </div>
          <h1 className="mt-3 font-display text-5xl sm:text-6xl leading-[0.9] drop-shadow-lg min-h-[3.2em] sm:min-h-[2.6em]">
            {headline.line1}
            {headline.showBreak && <br />}
            <span className="text-brand">{headline.line2}</span>
            <span className="ml-0.5 inline-block w-[0.08em] h-[0.9em] align-baseline bg-white/80 animate-pulse" aria-hidden />
          </h1>
          <p className="mt-4 text-sm text-white/85 max-w-xs">
            {heroBody}
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link to="/menu" className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-bold text-brand-foreground hover:bg-brand-dark transition-colors shadow-lg shadow-brand/40">
              {settings.primary_cta_label} <ChevronRight className="h-4 w-4" />
            </Link>
            <Link to="/track" className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-black/20 backdrop-blur px-6 py-3 text-sm font-semibold text-white hover:bg-white/10">
              {settings.secondary_cta_label}
            </Link>
          </div>
        </div>
      </section>

      {/* Promotions strip */}
      {settings.show_promotions && promos.length > 0 && (
        <section className="mx-auto max-w-lg px-5 pt-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-brand" />
            <h2 className="font-display text-2xl">Today's specials</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
            {promos.map((p) => (
              <Link key={p.id} to="/menu" hash="promos" className="shrink-0 w-64 rounded-2xl border border-border bg-card p-4 relative overflow-hidden">
                {p.badge && (
                  <div className="absolute top-3 right-3 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-brand-foreground uppercase tracking-wider">
                    {p.badge}
                  </div>
                )}
                {p.image_url && <img src={p.image_url} alt={p.title} className="mb-3 h-24 w-full rounded-lg object-cover" />}
                <div className="font-display text-xl">{p.title}</div>
                {p.description && <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.description}</div>}
                {p.price_cents != null && (
                  <div className="mt-2 font-display text-2xl text-brand">{formatZAR(p.price_cents)}</div>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Quick categories */}
      {settings.show_categories && <section className="mx-auto max-w-lg px-5 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-2xl">Browse the menu</h2>
          <Link to="/menu" className="text-sm font-semibold text-brand">See all</Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { title: "Chicken", desc: "1pc → 21pc bucket", img: imageSrcFor("chicken-hero", media, "chicken-hero"), slug: "chicken" },
            { title: "Combos", desc: "Chicken + chips", img: imageSrcFor("chicken-chips", media, "chicken-chips"), slug: "combos" },
            { title: "Burgers", desc: "Mississippi, Dekka", img: imageSrcFor("burger-card", media, "burger-card"), slug: "burgers" },
            { title: "Shakes", desc: "Cold & creamy", img: imageSrcFor("shakes-card", media, "shakes-card"), slug: "shakes" },
          ].map((c) => (
            <Link
              key={c.slug}
              to="/menu"
              hash={c.slug}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card aspect-[4/3] transition-colors"
            >
              <img src={c.img} alt="" className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition-transform" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-3 text-white">
                <div className="font-display text-xl">{c.title}</div>
                <div className="text-[11px] opacity-80">{c.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>}

      {/* Brand strip */}
      {settings.show_brand_strip && <section className="mx-auto max-w-lg px-5 pt-6">
        <div className="grid grid-cols-2 gap-3">
          <img src={imageSrcFor("couple", media, "couple")} alt="Customers enjoying Champs" className="rounded-2xl aspect-square object-cover" />
          <img src={imageSrcFor("chef", media, "chef")} alt="Champs chef" className="rounded-2xl aspect-square object-cover" />
        </div>
        <p className="mt-3 text-center font-display text-2xl text-brand">We love to serve.</p>
      </section>}

      {/* Store info per active branch */}
      {settings.show_branch_info && <section className="mx-auto max-w-lg px-5 pt-6">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Your branch</div>
            <span className="text-xs font-bold text-brand">{active?.name}</span>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-brand mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-semibold">{active?.address ?? "—"}</div>
              <div className="text-muted-foreground">{active?.city}, {active?.postal_code}</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-brand mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-semibold">Open every day</div>
              <div className="text-muted-foreground">
                {active?.opens_at?.slice(0, 5)} – {active?.closes_at?.slice(0, 5)}
              </div>
            </div>
          </div>
          {active?.phone && (
            <div className="flex items-start gap-3">
              <Phone className="h-5 w-5 text-brand mt-0.5 shrink-0" />
              <a href={`tel:${active.phone}`} className="text-sm font-semibold">{active.phone}</a>
            </div>
          )}
        </div>
      </section>}

      <BottomNav />
      <Footer />
    </div>
  );
}

type TypeState = { line1: string; showBreak: boolean; line2: string };

function useTypewriter(
  lines: string[],
  opts: { typeMs?: number; holdMs?: number; eraseMs?: number } = {},
): TypeState {
  const { typeMs = 60, holdMs = 1500, eraseMs = 30 } = opts;
  const [state, setState] = useState<TypeState>({ line1: "", showBreak: false, line2: "" });
  const [a = "", b = ""] = lines;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      while (!cancelled) {
        // type line 1
        for (let i = 1; i <= a.length; i++) {
          if (cancelled) return;
          setState({ line1: a.slice(0, i), showBreak: false, line2: "" });
          await wait(typeMs);
        }
        if (cancelled) return;
        setState((s) => ({ ...s, showBreak: true }));
        // type line 2
        for (let i = 1; i <= b.length; i++) {
          if (cancelled) return;
          setState({ line1: a, showBreak: true, line2: b.slice(0, i) });
          await wait(typeMs);
        }
        await wait(holdMs);
        // erase line 2
        for (let i = b.length; i >= 0; i--) {
          if (cancelled) return;
          setState({ line1: a, showBreak: true, line2: b.slice(0, i) });
          await wait(eraseMs);
        }
        if (cancelled) return;
        setState({ line1: a, showBreak: false, line2: "" });
        // erase line 1
        for (let i = a.length; i >= 0; i--) {
          if (cancelled) return;
          setState({ line1: a.slice(0, i), showBreak: false, line2: "" });
          await wait(eraseMs);
        }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [a, b, typeMs, holdMs, eraseMs]);

  return state;
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}


