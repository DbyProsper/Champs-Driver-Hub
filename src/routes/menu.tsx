import { createFileRoute } from "@tanstack/react-router";
import { Plus, Minus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { menuQuery, type MenuItem } from "@/lib/menu-queries";
import { useCart } from "@/lib/cart";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getMenuImageForItem } from "@/lib/menu-images";
import { getMenuIconForItem, getCategoryIcon } from "@/lib/menu-icons";
import { activePromotionsQuery } from "@/lib/user-queries";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "Menu — Champs Chicken" },
      { name: "description", content: "Full Champs Chicken menu: fried chicken, chips, sauces, burgers, fish, combos, desserts, shakes and drinks." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(menuQuery),
  errorComponent: ({ error }) => <div className="p-6 text-sm">Failed to load menu: {error.message}</div>,
  notFoundComponent: () => <div className="p-6 text-sm">No menu items yet.</div>,
  component: MenuPage,
});

// Combined sticky offset: main Header (~56px) + tab bar (~46px) + small buffer
const SCROLL_OFFSET = 112;

function MenuPage() {
  const initialData = Route.useLoaderData();
  const { data = initialData } = useQuery(menuQuery);
  const { data: activePromos = [] } = useQuery(activePromotionsQuery);
  const { active: activeBranch } = useBranch();
  const queryClient = useQueryClient();
  const { categories, items } = data;
  const activePromoTitles = useMemo(() => new Set(activePromos.filter((promo) => !promo.branch_id || promo.branch_id === activeBranch?.id).map((promo) => promo.title.trim().toLowerCase())), [activePromos, activeBranch?.id]);
  const visibleItems = useMemo(() => items.filter((item) => {
    const category = categories.find((entry) => entry.id === item.category_id);
    return category?.slug !== "promos" || activePromoTitles.has(item.name.trim().toLowerCase());
  }), [items, categories, activePromoTitles]);
  const hasVisiblePromos = visibleItems.some((item) => categories.find((category) => category.id === item.category_id)?.slug === "promos");
  const displayCategories = useMemo(() => {
    const hasSalads = categories.some((c) => c.slug === "salads" || c.name.toLowerCase().includes("salad"));
    const hasDrinks = categories.some((c) => c.slug === "drinks" || c.name.toLowerCase().includes("drink"));
    const hasExtras = categories.some((c) => c.slug === "extras" || c.name.toLowerCase().includes("extra"));

    let nextCategories = categories;
    const promosCategory = hasVisiblePromos ? categories.find((c) => c.slug === "promos") : undefined;
    nextCategories = nextCategories.filter((category) => category.slug !== "promos");
    if (promosCategory) {
      nextCategories = [promosCategory, ...nextCategories.filter((c) => c.id !== promosCategory.id)];
    }
    const saladsCategory = { id: "salads-section", name: "Salads", slug: "salads", sort_order: 999 };
    const drinksCategory = { id: "drinks-section", name: "Drinks", slug: "drinks", sort_order: 999 };
    const extrasCategory = { id: "extras-section", name: "Extras", slug: "extras", sort_order: 999 };

    if (!hasSalads) {
      const chipsIndex = nextCategories.findIndex((c) => c.slug === "chips" || c.name.toLowerCase().includes("chips"));
      nextCategories = chipsIndex === -1
        ? [...nextCategories, saladsCategory]
        : [...nextCategories.slice(0, chipsIndex + 1), saladsCategory, ...nextCategories.slice(chipsIndex + 1)];
    }

    if (!hasDrinks) {
      const insertAfter = nextCategories.reduce((lastIndex, c, index) => {
        return /(shake|frostee|sundae|dessert)/.test(c.slug) || /(shake|frostee|sundae|dessert)/.test(c.name.toLowerCase())
          ? index
          : lastIndex;
      }, -1);
      nextCategories = insertAfter === -1
        ? [...nextCategories, drinksCategory]
        : [...nextCategories.slice(0, insertAfter + 1), drinksCategory, ...nextCategories.slice(insertAfter + 1)];
    }

    if (!hasExtras) {
      const drinksIndex = nextCategories.findIndex((c) => c.slug === "drinks" || c.name.toLowerCase().includes("drink"));
      const insertAfter = drinksIndex !== -1 ? drinksIndex : nextCategories.reduce((lastIndex, c, index) => {
        return /(shake|frostee|sundae|dessert)/.test(c.slug) || /(shake|frostee|sundae|dessert)/.test(c.name.toLowerCase())
          ? index
          : lastIndex;
      }, -1);
      nextCategories = insertAfter === -1
        ? [...nextCategories, extrasCategory]
        : [...nextCategories.slice(0, insertAfter + 1), extrasCategory, ...nextCategories.slice(insertAfter + 1)];
    }

    return nextCategories;
  }, [categories, hasVisiblePromos]);

  const [active, setActive] = useState(displayCategories[0]?.slug ?? "");
  const tabsRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<Record<string, HTMLElement | null>>({});
  const isClickScrollRef = useRef(false);

  const grouped = useMemo(() => {
    const map: Record<string, MenuItem[]> = {};
    for (const c of displayCategories) map[c.slug] = [];
    const drinkCategory = displayCategories.find((c) => c.slug === "drinks" || c.name.toLowerCase().includes("drink"));
    const extrasCategory = displayCategories.find((c) => c.slug === "extras" || c.name.toLowerCase().includes("extra"));
    const drinkMatcher = /\b(?:pepsi|coke|mountain dew|powerade|spar letta|spar)\b/i;
    const bunMatcher = /\bbuns?\b/i;

    for (const it of visibleItems) {
      const combinedName = `${it.name} ${it.variant_label ?? ""}`;

      // Place Fish Burger explicitly into the Burgers section when present
      const burgerCategory = displayCategories.find((c) => /burger/.test(c.slug) || /burger/.test(c.name.toLowerCase()));
      if (/fish\s*burger/i.test(it.name) && burgerCategory) {
        if (!map[burgerCategory.slug]) map[burgerCategory.slug] = [];
        map[burgerCategory.slug].push(it);
        continue;
      }

      // Place drink items into the Drinks section
      if (drinkMatcher.test(combinedName) && drinkCategory) {
        if (!map[drinkCategory.slug]) map[drinkCategory.slug] = [];
        map[drinkCategory.slug].push(it);
        continue;
      }

      // Place bun items into the Extras section
      if (bunMatcher.test(combinedName) && extrasCategory) {
        if (!map[extrasCategory.slug]) map[extrasCategory.slug] = [];
        map[extrasCategory.slug].push(it);
        continue;
      }

      // Place all items whose name contains "salad" into the Salads section
      if (/salad/i.test(it.name)) {
        if (!map["salads"]) map["salads"] = [];
        map["salads"].push(it);
        continue;
      }
      const cat = categories.find((c) => c.id === it.category_id);
      if (cat && map[cat.slug]) map[cat.slug].push(it);
    }
    return map;
  }, [displayCategories, categories, visibleItems]);

  useEffect(() => {
    const channel = supabase.channel("public-menu-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, () => void queryClient.invalidateQueries({ queryKey: ["menu"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => void queryClient.invalidateQueries({ queryKey: ["menu"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "promotions" }, () => void queryClient.invalidateQueries({ queryKey: ["promotions"] }))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  // Scroll-spy: pick the section whose top is closest to (but not past) the sticky-header line.
  useEffect(() => {
    function onScroll() {
      if (isClickScrollRef.current) return;
      const threshold = SCROLL_OFFSET + 8;
      let current = categories[0]?.slug ?? "";
      for (const c of displayCategories) {
        const el = sectionsRef.current[c.slug];
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - threshold <= 0) current = c.slug;
        else break;
      }
      setActive((prev) => (prev === current ? prev : current));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [categories]);

  // Auto-scroll active tab into view horizontally
  useEffect(() => {
    const bar = tabsRef.current;
    if (!bar) return;
    const el = bar.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [active]);

  const scrollTo = useCallback((slug: string) => {
    const el = sectionsRef.current[slug];
    if (!el) return;
    setActive(slug);
    isClickScrollRef.current = true;
    const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.scrollTo({ top, behavior: "smooth" });
    window.setTimeout(() => { isClickScrollRef.current = false; }, 900);
  }, []);

  // Deep link from home hash
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && grouped[hash]) {
      setTimeout(() => scrollTo(hash), 150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen pb-24">
      <Header subtitle="Menu" />

      {/* Sticky category tabs — highlights active section on scroll */}
      <div className="sticky top-[54px] z-20 border-b border-border bg-background/95 backdrop-blur">
        <div ref={tabsRef} className="mx-auto max-w-lg overflow-x-auto no-scrollbar">
          <div className="flex gap-2 px-4 py-2 min-w-max">
              {displayCategories.map((c) => (
              <button
                key={c.id}
                data-tab={c.slug}
                onClick={() => scrollTo(c.slug)}
                className={cn(
                  "group shrink-0 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all",
                  active === c.slug
                    ? "bg-brand text-brand-foreground shadow-md scale-105"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden className="mr-2 inline-block">{getCategoryIcon(c.slug || c.name)}</span>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 py-4 space-y-8">
        {displayCategories.map((c) => (
          <section
            key={c.id}
            id={c.slug}
            data-slug={c.slug}
            ref={(el) => { sectionsRef.current[c.slug] = el; }}
            className="scroll-mt-32"
          >
            <h2 className="font-display text-3xl text-brand mb-3">{c.name}</h2>
            <div className="space-y-2">
                {grouped[c.slug]?.map((it) => <Row key={it.id} item={it} />)}
            </div>
          </section>
        ))}
      </div>

      <BottomNav />
    </div>
  );
}

function Row({ item }: { item: MenuItem }) {
  const { items, add, setQty } = useCart();
  const mealLineId = `${item.id}:meal`;
  const burgerLineId = `${item.id}:burger-only`;
  const hasBurgerOnly = item.burger_only_price_cents != null;
  const inCart = items.find((i) => i.id === (hasBurgerOnly ? mealLineId : item.id));
  const qty = inCart?.quantity ?? 0;

  const label = item.variant_label ? `${item.name} — ${item.variant_label}` : item.name;
  const available = item.is_available;
  const auto = getMenuImageForItem(item.name, item.variant_label);
  const image = item.image_url ? { src: item.image_url, alt: label } : auto;
  const description = getMenuDescription(item.name, item.variant_label, item.description);

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-border bg-card p-3", !available && "opacity-50")}>
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/60">
        <img src={image.src} alt={image.alt} className="h-full w-full object-cover" />
        {item.special_price_cents != null && (
          <span className="absolute left-1 top-1 rounded-full bg-brand px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-brand-foreground shadow-sm">
            Special
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-semibold text-sm truncate">{label}</div>
          <div className="shrink-0 text-right"><div className="font-display text-lg text-brand">{formatZAR(item.special_price_cents ?? item.price_cents)}</div>{item.special_price_cents != null && <div className="text-[11px] text-muted-foreground line-through">{formatZAR(item.price_cents)}</div>}</div>
        </div>
        {description && (
          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            <span aria-hidden className="mr-0 inline-block">{item.icon_text || getMenuIconForItem(item.name, item.variant_label ?? undefined)}</span>
            {description}
          </div>
        )}
        {!available && <div className="mt-0.5 text-[10px] uppercase tracking-wider text-brand font-bold">Sold out</div>}
      </div>
      {!available ? null : hasBurgerOnly ? (
        <div className="flex shrink-0 flex-col gap-1.5">
          <button onClick={() => { add({ id: mealLineId, menu_item_id: item.id, name: item.name, variant: item.variant_label || "Meal", unit_price_cents: item.special_price_cents ?? item.price_cents, image_url: item.image_url }); toast.success(`Added ${label} meal`); }} className="rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-brand-foreground">Meal · {formatZAR(item.special_price_cents ?? item.price_cents)}</button>
          <button onClick={() => { add({ id: burgerLineId, menu_item_id: item.id, name: item.name, variant: "Burger only", unit_price_cents: item.burger_only_price_cents!, image_url: item.image_url }); toast.success(`Added ${item.name} burger only`); }} className="rounded-full border px-3 py-1.5 text-[11px] font-bold">Burger only · {formatZAR(item.burger_only_price_cents!)}</button>
        </div>
      ) : qty === 0 ? (
        <button
          onClick={() => {
            add({ id: item.id, menu_item_id: item.id, name: item.name, variant: item.variant_label, unit_price_cents: item.special_price_cents ?? item.price_cents, image_url: item.image_url });
            toast.success(`Added ${label}`);
          }}
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground hover:bg-brand-dark"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      ) : (
        <div className="shrink-0 inline-flex items-center gap-2 rounded-full bg-muted px-1 py-1">
          <button onClick={() => setQty(item.id, qty - 1)} className="grid h-7 w-7 place-items-center rounded-full bg-background text-brand hover:bg-brand hover:text-brand-foreground">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-4 text-center text-sm font-bold">{qty}</span>
          <button onClick={() => setQty(item.id, qty + 1)} className="grid h-7 w-7 place-items-center rounded-full bg-brand text-brand-foreground hover:bg-brand-dark">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function getMenuDescription(name: string, variant: string | null, description: string | null) {
  if (description?.trim()) return description.trim();
  const lower = `${name} ${variant ?? ""}`.toLowerCase();

  if (/fish burger/.test(lower)) {
    return `Fish patty, lettuce and special Champs sauce in a toasted bun.`;
  }
  if (/\b(?:1|2|3|4|5)\s*piece\b/.test(lower) && /chicken/.test(lower)) {
    return `Crispy fried chicken made with Champs signature seasoning.`;
  }
  if (/\b(?:9|21)\s*piece\b/.test(lower) && /chicken/.test(lower)) {
    return `A larger chicken portion, crispy on the outside and juicy inside.`;
  }
  if (/\b1\s*piece\s*fish\b/.test(lower)) {
    return `Lightly battered fish served with crisp chips.`;
  }
  if (/fish\s*(?:&|and)\s*chips/.test(lower)) {
    return `Crispy fish served with chips.`;
  }
  if (/combo|bucket|meal/.test(lower)) {
    return `Crispy chicken and golden chips paired together for a perfect meal.`;
  }
  if (/shake|frostee|milkshake|smoothie/.test(lower)) {
    if (/frostee(?:.*choc|.*chocolate)|choc.*frostee/.test(lower)) {
      return `Creamy chocolate shake made with rich flavouring and ice-cold milk.`;
    }
    return `Creamy shake made with rich flavouring and ice-cold milk.`;
  }
  if (/sauce|dip/.test(lower)) {
    return `Perfect sauce for dipping and boosting every bite.`;
  }
  if (/bun(?:s)?/.test(lower)) {
    return `Soft fresh buns to complete your meal.`;
  }
  if (/\b(?:pepsi|coke|mountain dew|powerade|spar letta|spar)\b/.test(lower)) {
    return `Chilled soft drink to pair with your meal.`;
  }
  if (/salad/.test(lower)) {
    return `Fresh salad with crisp greens and house-made dressing.`;
  }
  if (/chips|fries/.test(lower)) {
    return `Golden, crispy chips cooked fresh to order.`;
  }
  if (/sundae|dessert|soft serve|ice cream|cone/.test(lower)) {
    return `Sweet treat to finish your meal on a delicious note.`;
  }
  if (/chicken/.test(lower)) {
    return `Crispy fried chicken made with Champs signature seasoning.`;
  }

  return description ?? `Classic Champs favourite made fresh for you.`;
}
