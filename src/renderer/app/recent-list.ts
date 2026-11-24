import type { RecentProjectView } from "../../shared/app.js";
import { calendarDaysAgo } from "./platform.js";

/*
 * Renderer-only presentation of the recent-project list (docs/R17_VISUAL_DESIGN.md §4.1):
 * filtering and date grouping of the RecentProjectView entries the main process already sent.
 * Nothing here needs, or could reveal, a filesystem path.
 */
export type RecentGroupId = "today" | "yesterday" | "week" | "older";

export const RECENT_GROUP_LABELS: Readonly<Record<RecentGroupId, string>> = {
  today: "Oggi", yesterday: "Ieri", week: "Ultimi 7 giorni", older: "Precedenti",
};
const GROUP_ORDER: readonly RecentGroupId[] = ["today", "yesterday", "week", "older"];

export interface RecentGroup {
  readonly id: RecentGroupId;
  readonly label: string;
  readonly entries: readonly RecentProjectView[];
}

/**
 * Local calendar day of `lastOpenedAt`: today (or a clock-skewed future time), yesterday, two to seven
 * days ago, and everything older, including an unreadable timestamp.
 */
export function recentGroupOf(lastOpenedAt: string, now: Date = new Date()): RecentGroupId {
  const days = calendarDaysAgo(lastOpenedAt, now);
  if (days === null) return "older";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return days <= 7 ? "week" : "older";
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every whitespace-separated term must appear (case and accent insensitive) in the title, file or folder label. */
export function filterRecent(entries: readonly RecentProjectView[], query: string): readonly RecentProjectView[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = fold(`${entry.title}\n${entry.documentName}\n${entry.folderLabel}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/** Non-empty groups in display order; each keeps the order the entries arrived in. */
export function groupRecent(entries: readonly RecentProjectView[], now: Date = new Date()): readonly RecentGroup[] {
  const byGroup = new Map<RecentGroupId, RecentProjectView[]>();
  for (const entry of entries) {
    const id = recentGroupOf(entry.lastOpenedAt, now);
    byGroup.set(id, [...(byGroup.get(id) ?? []), entry]);
  }
  return GROUP_ORDER.flatMap((id) => {
    const grouped = byGroup.get(id);
    return grouped ? [{ id, label: RECENT_GROUP_LABELS[id], entries: grouped }] : [];
  });
}

/** The entries in the order the grouped table shows them; keyboard selection walks this list. */
export function visibleRecent(groups: readonly RecentGroup[]): readonly RecentProjectView[] {
  return groups.flatMap((group) => group.entries);
}

/** Index of the selected entry in the visible list: the first row when the selection is gone, -1 when empty. */
export function selectedRecentIndex(visible: readonly RecentProjectView[], selectedId: string | null): number {
  if (visible.length === 0) return -1;
  const index = visible.findIndex((entry) => entry.id === selectedId);
  return index < 0 ? 0 : index;
}

/** Where the selection goes when `id` leaves the visible list: the next row, else the previous one. */
export function neighbourOf(visible: readonly RecentProjectView[], id: string): string | null {
  const index = visible.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  return (visible[index + 1] ?? visible[index - 1])?.id ?? null;
}
