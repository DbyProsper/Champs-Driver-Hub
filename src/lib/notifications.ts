// Foreground browser notifications (Notification API). No service worker required.
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
  try {
    new Notification(title, { body, tag, icon: "/favicon.ico", badge: "/favicon.ico" });
  } catch {}
}
