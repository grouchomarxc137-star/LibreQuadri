/** True in the macOS renderer. Only used for shortcut labels and modifier keys. */
export function isMacPlatform(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Macintosh|Mac OS X/.test(userAgent);
}

/** Label for a CmdOrCtrl shortcut, e.g. "⌘N" on macOS and "Ctrl+N" elsewhere. */
export function shortcutLabel(key: string, mac = isMacPlatform()): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

const dateFormatter = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });

/** Calendar days between the local day of `iso` and the local day of `now`; null for an invalid date. */
export function calendarDaysAgo(iso: string, now: Date = new Date()): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return null;
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).valueOf();
  return Math.round((day(now) - day(date)) / 86_400_000);
}

/** "oggi 11:42", "ieri 17:05" or "12/09/2026", in local time. */
export function formatLastOpened(iso: string, now: Date = new Date()): string {
  const difference = calendarDaysAgo(iso, now);
  if (difference === null) return "";
  const date = new Date(iso);
  if (difference === 0) return `oggi ${timeFormatter.format(date)}`;
  if (difference === 1) return `ieri ${timeFormatter.format(date)}`;
  return dateFormatter.format(date);
}
