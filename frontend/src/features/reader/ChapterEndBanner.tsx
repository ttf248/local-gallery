import { Link } from "react-router-dom";
import { Button } from "../../ui/Button";
import { albumRoute, libraryRoute } from "../../utils/path";
import type { ReaderController } from "./useReaderController";
export function ChapterEndBanner({ reader }: { reader: ReaderController }) {
  const next = reader.adjacentNames,
    parent = reader.albumSummary?.parentId;
  return (
    <section className="mx-auto my-8 max-w-md space-y-3 rounded-2xl border border-theater-border bg-theater-surface p-5 text-center text-theater-fg">
      <h2>{reader.hasNextVolume ? "本话已读完" : "已读完本作品最新话"}</h2>
      {reader.hasNextVolume && (
        <>
          <p>
            下一话：{next.next}
            {next.nextPages ? `（${next.nextPages} 页）` : ""}
          </p>
          <Button
            onClick={() => void reader.goAdjacent(1, { albumsOnly: true })}
          >
            继续阅读下一话
          </Button>
        </>
      )}
      <Link
        className="block underline"
        to={
          reader.hasNextVolume && parent
            ? albumRoute("comic", parent)
            : libraryRoute("comic")
        }
      >
        {reader.hasNextVolume && parent ? "返回作品目录" : "返回书架"}
      </Link>
    </section>
  );
}
