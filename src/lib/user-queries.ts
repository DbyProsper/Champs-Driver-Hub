import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const myOrdersQuery = (userId: string | null) =>
  queryOptions({
    queryKey: ["my-orders", userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [];
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, status, subtotal_cents, delivery_fee_cents, fulfillment, created_at, branch_id, driver_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      if (!orders || orders.length === 0) return [];
      const ids = orders.map((o) => o.id);
      const { data: items } = await supabase
        .from("order_items")
        .select("order_id, item_name, quantity, menu_item_id, unit_price_cents")
        .in("order_id", ids);
      const byOrder: Record<string, typeof items> = {};
      (items ?? []).forEach((r) => {
        (byOrder[r.order_id] ??= []).push(r);
      });
      return orders.map((o) => ({ ...o, items: byOrder[o.id] ?? [] }));
    },
  });

export const activePromotionsQuery = queryOptions({
  queryKey: ["promotions"],
  queryFn: async () => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("promotions")
      .select("*")
      .eq("is_active", true)
      .or(`active_from.is.null,active_from.lte.${now}`)
      .or(`active_until.is.null,active_until.gte.${now}`)
      .order("sort_order");
    if (error) throw error;
    const johannesburgDay = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", weekday: "short" }).formatToParts(new Date()).find((part) => part.type === "weekday")?.value && new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", weekday: "short" }).format(new Date()) ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", weekday: "short" }).format(new Date())) : new Date().getDay());
    return (data ?? []).filter((promo: any) => {
      if (!promo.is_active) return false;
      if (promo.active_from && new Date(promo.active_from) > new Date()) return false;
      if (promo.active_until && new Date(promo.active_until) < new Date()) return false;
      if (promo.day_of_week != null && promo.day_of_week !== johannesburgDay) return false;
      return true;
    });
  },
  staleTime: 30_000,
});
