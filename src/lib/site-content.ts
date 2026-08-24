import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SiteSettings = Database["public"]["Tables"]["site_settings"]["Row"];
export type MediaAsset = Database["public"]["Tables"]["media_assets"]["Row"];

export const LOCAL_IMAGE_SRC = {
  "girls-lunch": "/images/champs/girls-lunch.jpg",
  "chicken-hero": "/images/champs/chicken-hero.jpg",
  "chicken-chips": "/images/champs/chicken-chips.jpg",
  chef: "/images/champs/chef.jpg",
  couple: "/images/champs/couple.jpg",
  "burger-card": "/images/champs/champs-burger.jpg",
  "shakes-card": "/images/champs/champs-shakes.jpg",
  "champs-logo": "/images/champs/champs-logo.jpeg",
} as const;

export const FALLBACK_SETTINGS: SiteSettings = {
  id: "main",
  hero_eyebrow: "Now taking online orders",
  hero_line_one: "Crispy. Bold.",
  hero_line_two: "Champs Chicken.",
  hero_body: "Freshly fried chicken, loaded chips and legendary combos. Order for pickup or delivery in your town.",
  hero_image_key: "girls-lunch",
  hero_focus_x: 50,
  hero_focus_y: 30,
  primary_cta_label: "Order now",
  secondary_cta_label: "Track order",
  theme: "classic-red",
  show_promotions: true,
  show_categories: true,
  show_brand_strip: true,
  show_branch_info: true,
  updated_at: new Date(0).toISOString(),
};

export const FALLBACK_MEDIA: MediaAsset[] = [
  { id: "fallback-girls", title: "Girls lunch hero", image_key: "girls-lunch", src: LOCAL_IMAGE_SRC["girls-lunch"], alt: "Customers enjoying Champs Chicken together", usage: "hero", is_active: true, sort_order: 10, created_at: "", updated_at: "" },
  { id: "fallback-chicken", title: "Chicken hero", image_key: "chicken-hero", src: LOCAL_IMAGE_SRC["chicken-hero"], alt: "Fresh Champs fried chicken", usage: "homepage-card", is_active: true, sort_order: 20, created_at: "", updated_at: "" },
  { id: "fallback-chips", title: "Chicken and chips", image_key: "chicken-chips", src: LOCAL_IMAGE_SRC["chicken-chips"], alt: "Champs chicken served with chips", usage: "homepage-card", is_active: true, sort_order: 30, created_at: "", updated_at: "" },
  { id: "fallback-chef", title: "Champs chef", image_key: "chef", src: LOCAL_IMAGE_SRC.chef, alt: "Champs kitchen team member", usage: "brand", is_active: true, sort_order: 40, created_at: "", updated_at: "" },
  { id: "fallback-couple", title: "Customers eating together", image_key: "couple", src: LOCAL_IMAGE_SRC.couple, alt: "Customers enjoying a meal at Champs", usage: "brand", is_active: true, sort_order: 50, created_at: "", updated_at: "" },
  { id: "fallback-burger", title: "Champs burger", image_key: "burger-card", src: LOCAL_IMAGE_SRC["burger-card"], alt: "Fresh Champs burger", usage: "homepage-card", is_active: true, sort_order: 45, created_at: "", updated_at: "" },
  { id: "fallback-shakes", title: "Champs shakes", image_key: "shakes-card", src: LOCAL_IMAGE_SRC["shakes-card"], alt: "Cold Champs shakes", usage: "homepage-card", is_active: true, sort_order: 55, created_at: "", updated_at: "" },
  { id: "fallback-logo", title: "Champs logo", image_key: "champs-logo", src: LOCAL_IMAGE_SRC["champs-logo"], alt: "Champs Chicken logo", usage: "logo", is_active: true, sort_order: 60, created_at: "", updated_at: "" },
];

export function mediaByKey(media: MediaAsset[]) {
  return new Map(media.map((item) => [item.image_key, item]));
}

export function imageSrcFor(key: string | null | undefined, media: MediaAsset[], fallbackKey: keyof typeof LOCAL_IMAGE_SRC = "chicken-hero") {
  const found = key ? mediaByKey(media).get(key) : null;
  return found?.src || LOCAL_IMAGE_SRC[fallbackKey];
}

export const siteContentQuery = queryOptions({
  queryKey: ["site-content"],
  queryFn: async (): Promise<{ settings: SiteSettings; media: MediaAsset[] }> => {
    const [settingsResult, mediaResult] = await Promise.all([
      supabase.from("site_settings").select("*").eq("id", "main").maybeSingle(),
      supabase.from("media_assets").select("*").order("sort_order"),
    ]);

    return {
      settings: (settingsResult.data as SiteSettings | null) ?? FALLBACK_SETTINGS,
      media: ((mediaResult.data as MediaAsset[] | null) ?? FALLBACK_MEDIA).length > 0 ? ((mediaResult.data as MediaAsset[] | null) ?? FALLBACK_MEDIA) : FALLBACK_MEDIA,
    };
  },
});
