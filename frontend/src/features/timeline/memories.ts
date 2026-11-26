import type { LibraryFeedItem } from "../../api/library";

export interface MemoryYear {
  year: number;
  yearsAgo: number;
  label: string;
  items: LibraryFeedItem[];
  cover: LibraryFeedItem;
}

export function groupMemoriesByYear(
  items: readonly LibraryFeedItem[],
  today: Date,
): MemoryYear[] {
  const currentYear = today.getFullYear();
  const years = new Map<number, LibraryFeedItem[]>();
  for (const item of items) {
    const date = item.dateValue?.match(/^(\d{4})(?:-|$)/);
    if (!date) continue;
    const year = Number(date[1]);
    if (year >= currentYear || year === 0) continue;
    const group = years.get(year);
    if (group) group.push(item);
    else years.set(year, [item]);
  }
  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, group]) => {
      group.sort((a, b) => a.dateValue!.localeCompare(b.dateValue!));
      const yearsAgo = currentYear - year;
      return {
        year,
        yearsAgo,
        label: `${yearsAgo} 年前`,
        items: group,
        cover:
          group.find(
            (item) =>
              (item.height ?? 0) > 0 && (item.width ?? 0) > item.height!,
          ) ?? group[0],
      };
    });
}
