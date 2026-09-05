import { useEffect, useState } from "react";
import { BellRing, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fireNotification,
  notificationPermission,
  requestNotificationPermission,
} from "@/lib/notifications";

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
const PROMPT_DISMISSED_KEY = "champs-notification-prompt-dismissed";

export function BrowserNotificationBridge() {
  const [userId, setUserId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [dismissed, setDismissed] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    const syncPermission = () => setPermission(notificationPermission());
    syncPermission();
    setDismissed(sessionStorage.getItem(PROMPT_DISMISSED_KEY) === "true");
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, []);

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

  const dismissPrompt = () => {
    sessionStorage.setItem(PROMPT_DISMISSED_KEY, "true");
    setDismissed(true);
  };

  const enableNotifications = async () => {
    if (!userId || requesting) return;
    setRequesting(true);
    try {
      const nextPermission = await requestNotificationPermission();
      setPermission(nextPermission);
      if (nextPermission === "granted") {
        const { error } = await (supabase as any)
          .from("user_notification_preferences")
          .upsert({ user_id: userId, browser_enabled: true }, { onConflict: "user_id" });
        if (error) toast.error("Alerts were allowed, but your notification preference could not be saved.");
        else {
          setPreferences((current) => ({ ...current, browser_enabled: true }));
          toast.success("Browser alert banners are enabled");
        }
      } else {
        toast.info("Notifications were not enabled. You can allow them later in your browser settings.");
      }
    } catch {
      setPermission(notificationPermission());
      toast.error("This browser could not open notification permissions. Check its site settings and try again.");
    } finally {
      setRequesting(false);
    }
  };

  const showPrompt = Boolean(userId && preferences.browser_enabled && !dismissed && permission !== "granted");
  if (!showPrompt) return null;

  const canRequest = permission === "default";
  const promptTitle = canRequest ? "Never miss a Champs update" : permission === "denied" ? "Browser alerts are blocked" : "Enable alerts on this device";
  const promptBody = canRequest
    ? "Allow order and message alerts. Your device can show them as banners while it is unlocked."
    : permission === "denied"
      ? "Open this site's notification settings and choose Allow. Banner display is controlled in your device notification settings."
      : "On iPhone, add Champs to your Home Screen, reopen it there, and then enable notifications.";

  return (
    <aside
      aria-label="Browser notification permission"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[90] mx-auto max-w-md rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl sm:bottom-5"
    >
      <button
        type="button"
        aria-label="Dismiss notification permission prompt"
        onClick={dismissPrompt}
        className="absolute right-2 top-2 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-7">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{promptTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{promptBody}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={dismissPrompt} className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted">
          Not now
        </button>
        {canRequest && (
          <button
            type="button"
            onClick={() => void enableNotifications()}
            disabled={requesting}
            className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {requesting && <Loader2 className="h-4 w-4 animate-spin" />}
            {requesting ? "Enabling..." : "Enable alert banners"}
          </button>
        )}
      </div>
    </aside>
  );
}
