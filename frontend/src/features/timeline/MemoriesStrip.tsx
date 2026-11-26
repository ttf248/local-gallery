import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { usePhotoMemories } from "../../hooks/useLibrary";
import { useUIStore } from "../../store/uiStore";
import { albumRoute } from "../../utils/path";
import { useWallViewer } from "../../hooks/useWallViewer";
import { SHORT_VIEWPORT_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { InlineAlert } from "../../ui/InlineAlert";
import { MemoriesHero } from "./MemoriesHero";
import { groupMemoriesByYear, type MemoryYear } from "./memories";
const PhotoViewer = lazy(() => import("../viewer/PhotoViewer"));

export default function MemoriesStrip() {
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
