import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Category = { id: string; name: string; slug: string; sort_order: number };
export type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  variant_label: string | null;
  description: string | null;
  price_cents: number;
  is_available: boolean;
  sort_order: number;
  image_url: string | null;
  special_price_cents: number | null;
  burger_only_price_cents: number | null;
  icon_text: string | null;
  comes_with_drink: boolean;
  promotion_id: string | null;
};


export const menuQuery = queryOptions({
  queryKey: ["menu"],
  queryFn: async (): Promise<{ categories: Category[]; items: MenuItem[] }> => {
    const [cats, items] = await Promise.all([
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("menu_items").select("*").order("sort_order"),
    ]);
    if (cats.error) throw cats.error;
    if (items.error) throw items.error;
    return { categories: cats.data as Category[], items: items.data as MenuItem[] };
  },
  staleTime: 0,
});
