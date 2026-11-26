import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOnThisDayAlbums } from "../../hooks/useLibrary";
import { useUIStore } from "../../store/uiStore";
import { ThumbImage } from "../common";
import { albumRoute } from "../../utils/path";
import { CloseIcon } from "../../ui/icons";
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
  const query = useOnThisDayAlbums("photo", month, day, 8, !dismissed, true);
  const photos = (query.data?.page.items ?? []).filter((item) => item.photo);
  if (dismissed || (!photos.length && !resume)) return null;
  return (
    <section
      aria-label="回忆"
      data-testid="on-this-day-strip"
      className="flex shrink-0 items-center gap-2 pb-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {photos.map(
          (item) =>
            item.photo && (
              <Link
                key={item.id}
                to={albumRoute("photo", item.id)}
                title={item.photo.date + " 拍的照片"}
                className="flex shrink-0 items-center gap-2 rounded-card bg-bg-subtle pr-3 text-caption"
              >
                <ThumbImage
                  fileId={item.photo.id}
                  version={item.photo.version}
                  displayWidth={56}
                  alt=""
                  className="size-12 rounded-l-card object-cover"
                />
                {item.photo.date?.slice(0, 4)} 年的今天
              </Link>
            ),
        )}
        {resume && (
          <Link
            to={resume.to}
            className="shrink-0 rounded-card bg-bg-subtle px-3 py-4 text-caption"
          >
            接着看 · {resume.title}
          </Link>
        )}
      </div>
      <button
        type="button"
        aria-label="今天隐藏回忆"
        className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-bg-subtle"
        onClick={() => useUIStore.getState().setMemoriesDismissedOn(date)}
      >
        <CloseIcon size={16} />
      </button>
    </section>
  );
}
