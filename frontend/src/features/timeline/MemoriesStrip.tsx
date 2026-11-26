import {
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useId,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { usePhotoMemories } from "../../hooks/useLibrary";
import { useUIStore } from "../../store/uiStore";
import { ThumbImage } from "../common";
import { albumRoute } from "../../utils/path";
import { useWallViewer } from "../../hooks/useWallViewer";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { ScrollRow } from "../../ui/ScrollRow";
import {
  onThisDayThumbWidth,
  ON_THIS_DAY_THUMB_HEIGHT,
} from "../../utils/onThisDay";
import { ChevronDownIcon, CloseIcon } from "../../ui/icons";
const PhotoViewer = lazy(() => import("../viewer/PhotoViewer"));

export default function MemoriesStrip({
  resume,
}: {
  resume?: { title: string; to: string };
}) {
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
  const photos = query.data?.items ?? [];
  const wall = useWallViewer({
    items: photos,
    albumName: (item) => item.albumName,
    albumHref: (item) => albumRoute("photo", item.albumId),
  });
  const shortScreen = useMediaQuery("(max-height: 520px)");
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const showPhotos = expanded ?? !shortScreen;
  const stripId = useId();
  if (dismissed || (!photos.length && !resume)) return null;

  const photosByDate = new Map<string, typeof photos>();
  for (const photo of photos) {
    const group = photosByDate.get(photo.dateValue);
    if (group) group.push(photo);
    else photosByDate.set(photo.dateValue, [photo]);
  }

  return (
    <section
      aria-label="回忆"
      data-testid="on-this-day-strip"
      className="min-w-0 shrink-0 pb-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        {photos.length > 0 && (
          <h2 className="shrink-0">
            <button
              type="button"
              aria-expanded={showPhotos}
              aria-controls={stripId}
              className="flex min-h-10 items-center gap-2 rounded-control text-body font-semibold"
              onClick={() => setExpanded(!showPhotos)}
            >
              那年今日
              <span className="text-caption font-normal tabular-nums text-fg-muted">
                {photos.length} 张
              </span>
              <ChevronDownIcon
                size={14}
                className={showPhotos ? "" : "-rotate-90"}
              />
            </button>
          </h2>
        )}
        {resume && (
          <Link
            to={resume.to}
            title={resume.title}
            className="ml-auto flex min-h-10 min-w-0 items-center rounded-control px-2 text-caption text-fg-muted hover:bg-bg-subtle hover:text-fg"
          >
            <span className="truncate">接着看 · {resume.title}</span>
          </Link>
        )}
        <button
          type="button"
          aria-label="今天隐藏回忆"
          title="今天隐藏回忆"
          className={
            (resume ? "" : "ml-auto ") +
            "grid size-10 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-bg-subtle hover:text-fg"
          }
          onClick={() => useUIStore.getState().setMemoriesDismissedOn(date)}
        >
          <CloseIcon size={16} />
        </button>
      </div>
      {photos.length > 0 && (
        <div id={stripId} hidden={!showPhotos}>
          <ScrollRow
            label="回忆照片"
            gap={16}
            snap={false}
            style={{ maskImage: "none" }}
          >
            {Array.from(photosByDate, ([dateValue, items]) => {
              const [year, month, day] = dateValue.split("-");
              const anniversary = dateValue.slice(5) === date.slice(5);
              const label = anniversary
                ? year + " 年的今天"
                : year + " 年 " + Number(month) + " 月 " + Number(day) + " 日";
              return (
                <div
                  key={dateValue}
                  role="group"
                  aria-label={label}
                  className="flex-none"
                >
                  <div className="flex gap-1">
                    {items.map((photo) => {
                      const width = onThisDayThumbWidth(
                        photo.width,
                        photo.height,
                      );
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          aria-label={label + " · " + photo.name}
                          title={photo.albumName + " · " + photo.name}
                          onClick={() => wall.openById(photo.id)}
                          style={
                            {
                              "--memory-aspect":
                                width / ON_THIS_DAY_THUMB_HEIGHT,
                            } as CSSProperties
                          }
                          className="flex-none rounded-tile focus-visible:ring-inset"
                        >
                          <ThumbImage
                            fileId={photo.id}
                            version={photo.version}
                            displayWidth={width}
                            undecodable={photo.undecodable}
                            alt=""
                            className="memory-thumbnail"
                          />
                        </button>
                      );
                    })}
                  </div>
                  <time
                    dateTime={dateValue}
                    className="sticky left-0 block w-max whitespace-nowrap pt-1 text-caption tabular-nums text-fg-muted"
                  >
                    {anniversary
                      ? year + " 年"
                      : dateValue.replaceAll("-", ".")}
                  </time>
                </div>
              );
            })}
          </ScrollRow>
        </div>
      )}
      {wall.viewer && (
        <Suspense fallback={null}>
          <PhotoViewer {...wall.viewer} />
        </Suspense>
      )}
    </section>
  );
}
