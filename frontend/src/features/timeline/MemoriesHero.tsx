import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { usePhotoMemories } from "../../hooks/useLibrary";
import { useUIStore } from "../../store/uiStore";
import { albumRoute } from "../../utils/path";
import { useWallViewer } from "../../hooks/useWallViewer";
import { SHORT_VIEWPORT_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { InlineAlert } from "../../ui/InlineAlert";
import { groupMemoriesByYear, type MemoryYear } from "./memories";
import { ScrollRow } from "../../ui/ScrollRow";
import { SectionHeader } from "../../ui/SectionHeader";
import { Sheet } from "../../ui/Sheet";
import { Menu } from "../../ui/Menu";
import { IconButton } from "../../ui/IconButton";
import { ChevronRightIcon, MoreHorizontalIcon } from "../../ui/icons";
import { ThumbImage } from "../common";

export interface MemoriesHeroProps {
  years: MemoryYear[];
  collapsed: boolean;
  onOpen: (year: MemoryYear, index: number) => void;
  onDismiss: () => void;
}

export function MemoriesHero({
  years,
  collapsed,
  onOpen,
  onDismiss,
}: MemoriesHeroProps) {
  const [sheet, setSheet] = useState(false);
  const folded = useUIStore((s) => s.memoriesCollapsed),
    setFolded = useUIStore((s) => s.setMemoriesCollapsed);
  if (!years.length) return null;
  const menu = (
    <Menu
      label="回忆选项"
      align="end"
      trigger={
        <IconButton label="回忆选项">
          <MoreHorizontalIcon size={20} />
        </IconButton>
      }
      items={[{ id: "dismiss", label: "今天不再显示", onSelect: onDismiss }]}
    />
  );
  const row = (
    <ScrollRow label="各年回忆" gap={12}>
      {years.map((year) => {
        const { cover, items } = year;
        return (
          <button
            key={year.year}
            type="button"
            aria-label={`${year.label}，${year.year} 年，${items.length} 张`}
            className="relative h-[184px] sm:h-[216px] aspect-[4/3] shrink-0 snap-start overflow-hidden rounded-xl bg-sunken text-left focus-visible:ring-inset"
            onClick={() => onOpen(year, items.indexOf(cover))}
          >
            <ThumbImage
              fileId={cover.id}
              version={cover.version}
              undecodable={cover.undecodable}
              displayWidth={280}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 flex h-[55%] flex-col justify-end bg-gradient-to-t from-black/[.62] to-transparent px-4 pb-4 text-white">
              <span className="text-title">{year.label}</span>
              <span className="text-caption text-white/80">
                {year.year} · {items.length} 张
              </span>
            </span>
            {items.length >= 2 && (
              <span
                aria-hidden="true"
                className="absolute right-3 top-3 flex -space-x-2"
              >
                {items.slice(0, 3).map((item) => (
                  <ThumbImage
                    key={item.id}
                    fileId={item.id}
                    version={item.version}
                    alt=""
                    displayWidth={28}
                    className="size-7 rounded-full border-2 border-white object-cover"
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
      {years.length === 1 &&
        years[0].items
          .filter((item) => item !== years[0].cover)
          .slice(0, 4)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={item.name}
              className="relative h-[184px] sm:h-[216px] aspect-square flex-none self-end overflow-hidden rounded-lg"
              onClick={() => onOpen(years[0], years[0].items.indexOf(item))}
            >
              <ThumbImage
                fileId={item.id}
                version={item.version}
                undecodable={item.undecodable}
                alt=""
                displayWidth={200}
                className="size-full object-cover"
              />
            </button>
          ))}
    </ScrollRow>
  );
  return (
    <section
      aria-label="回忆"
      data-testid="on-this-day-strip"
      className="min-w-0 shrink-0 pb-2"
    >
      {folded ? (
        <button
          className="min-h-10 rounded-full bg-sunken px-3 text-label"
          onClick={() => setFolded(false)}
        >
          展开往年今日
        </button>
      ) : collapsed ? (
        <>
          <div className="flex items-center gap-2">
            <button
              className="flex min-h-10 items-center gap-2 rounded-full bg-sunken px-4 text-label"
              onClick={() => setSheet(true)}
            >
              那年今日 · {years.length} 个年份 <ChevronRightIcon size={16} />
            </button>
            <button className="text-caption" onClick={() => setFolded(true)}>
              收起回忆
            </button>
            {menu}
          </div>
          <Sheet
            side="bottom"
            label="那年今日"
            open={sheet}
            onClose={() => setSheet(false)}
          >
            <SectionHeader title="那年今日" />
            {row}
          </Sheet>
        </>
      ) : (
        <>
          <SectionHeader
            title="那年今日"
            action={
              <div className="flex items-center gap-2">
                <button
                  className="min-h-10 text-caption"
                  onClick={() => setFolded(true)}
                >
                  收起回忆
                </button>
                {menu}
              </div>
            }
          />
          {row}
        </>
      )}
    </section>
  );
}

const PhotoViewer = lazy(() => import("../viewer/PhotoViewer"));

export default function TimelineMemories() {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const midnight = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );
    const timer = setTimeout(
      () => setToday(new Date()),
      Math.max(1, midnight.getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [today]);
  const month = today.getMonth() + 1,
    day = today.getDate();
  const date = [
    today.getFullYear(),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
  const dismissed = useUIStore((s) => s.memoriesDismissedOn === date);
  const query = usePhotoMemories(date, !dismissed);
  const years = useMemo(
    () => groupMemoriesByYear(query.data?.items ?? [], today),
    [query.data, today],
  );
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const collapsed = useMediaQuery(SHORT_VIEWPORT_QUERY);
  const wall = useWallViewer({
    items: years.find((year) => year.year === selectedYear)?.items ?? [],
    albumName: (item) => item.albumName,
    albumHref: (item) => albumRoute("photo", item.albumId),
  });
  const open = (year: MemoryYear, index: number) => {
    setSelectedYear(year.year);
    wall.openById(year.items[index].id);
  };
  if (dismissed) return null;
  if (query.isError)
    return (
      <InlineAlert tone="warning" onRetry={() => void query.refetch()}>
        回忆加载失败
      </InlineAlert>
    );
  return (
    <>
      <MemoriesHero
        years={years}
        collapsed={collapsed}
        onOpen={open}
        onDismiss={() => {
          const { setMemoriesDismissedOn, pushToast } = useUIStore.getState();
          setMemoriesDismissedOn(date);
          pushToast({
            kind: "info",
            message: "今天已隐藏回忆",
            action: {
              label: "恢复",
              onClick: () => setMemoriesDismissedOn(null),
            },
          });
        }}
      />
      {wall.viewer && (
        <Suspense fallback={null}>
          <PhotoViewer {...wall.viewer} />
        </Suspense>
      )}
    </>
  );
}
