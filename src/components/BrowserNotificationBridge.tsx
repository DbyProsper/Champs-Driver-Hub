import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fireNotification } from "@/lib/notifications";

type NotificationRow = {
  id: string;
  type: string;
  message: string;
};

type Preferences = {
  browser_enabled: boolean;
  order_updates: boolean;
  message_alerts: boolean;
};

const defaults: Preferences = { browser_enabled: true, order_updates: true, message_alerts: true };

export function BrowserNotificationBridge() {
  const [userId, setUserId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaults);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const nextUserId = data.user?.id ?? null;
      setUserId(nextUserId);
      if (!nextUserId) return setPreferences(defaults);
      const { data: row } = await (supabase as any)
        .from("user_notification_preferences")
        .select("browser_enabled,order_updates,message_alerts")
        .eq("user_id", nextUserId)
        .maybeSingle();
      if (active) setPreferences(row ?? defaults);
    };
    void load();
    const { data } = supabase.auth.onAuthStateChange(() => void load());
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`browser-alerts:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        const item = payload.new as NotificationRow;
        if (!preferences.browser_enabled) return;
        if (item.type === "new_message" && !preferences.message_alerts) return;
        if (item.type !== "new_message" && !preferences.order_updates) return;
        const title = item.type === "driver_assigned" ? "New Champs order" : item.type === "new_message" ? "New Champs message" : "Champs order update";
        fireNotification(title, item.message, `champs-${item.id}`);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_notification_preferences", filter: `user_id=eq.${userId}` }, async () => {
        const { data } = await (supabase as any).from("user_notification_preferences").select("browser_enabled,order_updates,message_alerts").eq("user_id", userId).maybeSingle();
        setPreferences(data ?? defaults);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, preferences.browser_enabled, preferences.message_alerts, preferences.order_updates]);

  return null;
}
