// Browser notifications are delivered through the service worker when available.
export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

export async function requestNotificationPermissionIfNeeded() {
  if (!notificationsSupported() || Notification.permission !== "default") return Notification.permission;
  return requestNotificationPermission();
}

export function fireNotification(title: string, body: string, tag?: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body,
    tag,
    icon: "/images/champs/champs-logo.png",
    badge: "/favicon.ico",
    silent: false,
    renotify: Boolean(tag),
    data: { url: typeof window === "undefined" ? "/" : window.location.href },
  };
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker
      .register("/notification-sw.js")
      .then((registration) => registration.showNotification(title, options))
      .catch(() => {
        try { new Notification(title, options); } catch {}
      });
    return;
  }
  try { new Notification(title, options); } catch {}
}
