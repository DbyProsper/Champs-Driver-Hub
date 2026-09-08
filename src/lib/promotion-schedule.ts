const SAST_OFFSET = "+02:00";

export function fromJohannesburgInput(value: string): string | null {
  if (!value) return null;
  return new Date(`${value.length === 16 ? value + ":00" : value}${SAST_OFFSET}`).toISOString();
}

export function toJohannesburgInput(value: string | null | undefined): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function johannesburgScheduleParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday), minutes: hour * 60 + minute };
}

export function promotionIsCurrent(promo: any, now = new Date()) {
  if (!promo.is_active) return false;
  if (promo.is_recurring) {
    if (promo.active_from && now < new Date(promo.active_from)) return false;
    const local = johannesburgScheduleParts(now);
    if (promo.day_of_week == null || promo.day_of_week !== local.day) return false;
    if (promo.active_from) {
      const start = johannesburgScheduleParts(new Date(promo.active_from));
      if (local.minutes < start.minutes) return false;
    }
    return true;
  }
  if (promo.active_from && new Date(promo.active_from) > now) return false;
  if (promo.active_until && new Date(promo.active_until) < now) return false;
  if (promo.day_of_week != null && promo.day_of_week !== johannesburgScheduleParts(now).day) return false;
  return true;
}
