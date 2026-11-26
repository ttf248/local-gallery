import { Dialog } from "../../ui/Dialog";
import { useImageInfo } from "../../hooks/useImageInfo";
import { useLibraryNodes } from "../../hooks/useLibrary";
import { useImageActivities } from "../../hooks/useImageActivity";
import { formatSize } from "../../utils/format";
import { formatDateTime } from "../../utils/date";
import {
  collectionTypeWord,
  collectionUnit,
  comicCopy,
  mediaUnit,
} from "../../utils/workbench";
import { isCompleted } from "../../utils/progress";
import ErrorBanner from "./ErrorBanner";
import CopyButton from "./CopyButton";

export type PropertiesTarget =
  { kind: "node"; id: string } | { kind: "image"; id: string };

interface Props {
  target: PropertiesTarget | null;
  onClose: () => void;
}

export default function PropertiesDialog({ target, onClose }: Props) {
  if (!target) return null;
  return (
    <Dialog
      open
      title="属性"
      onClose={onClose}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="space-y-3 text-body">
        {target.kind === "node" ? (
          <NodeProperties key={target.id} nodeId={target.id} />
        ) : (
          <ImageProperties key={target.id} fileId={target.id} />
        )}
      </div>
    </Dialog>
  );
}

function NodeProperties({ nodeId }: { nodeId: string }) {
  const query = useLibraryNodes([nodeId]);
  const node = query.data?.items.find((item) => item.id === nodeId);
  // 漫画相册的阅读进度是这一页最该说的一件事：属性表里没有它，
  // 用户只能自己点进去翻一遍才知道读到哪。
  const isComicAlbum = node?.kind === "album" && node?.contentKind === "comic";
  const activityQuery = useImageActivities(
    isComicAlbum ? [nodeId] : [],
    isComicAlbum,
  );
  const activity = activityQuery.data?.[nodeId];
  const comic = comicCopy();
  return (
    <>
      {query.isLoading && (
        <p role="status" className="text-ink-2 text-caption">
          加载中…
        </p>
      )}
      {query.isError && (
        <LoadError
          message="无法读取目录属性"
          retry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {!query.isLoading && !query.isError && !node && (
        <p>此目录已不在媒体库中</p>
      )}
      {node && (
        <>
          <dl className="divide-y divide-line">
            <Field
              label="名称"
              value={node.virtual && node.location ? node.location : node.name}
              copyable
            />
            <Field
              label="类型"
              value={
                node.kind === "collection"
                  ? // 中间目录的类型词跟着工作台走：漫画侧叫「作品」，
                    // 照片侧叫「文件夹」—— 那一侧结构页的眉标同一个词。
                    collectionTypeWord(node.contentKind ?? "photo")
                  : node.virtual
                    ? // 「本目录媒体」是服务端的技术叫法，界面上读不出
                      // 这是什么；别处一律叫「散图」。
                      "散图"
                    : "相册"
              }
            />
            {/* 所属作品：漫画卷的名字只写「第2卷」，属性表里没有所属
                作品时，这一条记录讲不清是哪一部的哪一卷。照片侧同一格
                写所属文件夹。 */}
            {node.parentName && node.parentName !== node.name && (
              <Field
                label={`所属${collectionTypeWord(node.contentKind ?? "photo")}`}
                value={node.parentName}
              />
            )}
            <Field
              label="来源"
              value={node.sourceName || "—"}
              copyable={!!node.sourceName}
            />
            {node.kind === "album" ? (
              <>
                {/* 计数单位跟着内容属性走：照片「张」，漫画「页」。
                   标签也跟着侧走 —— 漫画侧写「图片」再配「10 页」，
                   读起来是自相矛盾的（那边的一张图就是一页）。 */}
                <Field
                  label={node.contentKind === "comic" ? "页面" : "图片"}
                  value={`${node.imageCount ?? 0} ${mediaUnit(node.contentKind)}`}
                />
                <Field label="视频" value={`${node.videoCount ?? 0} 个`} />
                {/* 阅读进度：漫画相册才有。已读完与在读分别说清楚，
                    不只给一个百分比 —— 「离结尾还有多远」不是
                    「翻到第几页」。 */}
                {activity && (
                  <Field
                    label="阅读进度"
                    value={
                      isCompleted({
                        index: activity.pageIndex,
                        total: activity.pageCount,
                      })
                        ? comic.finishedLabel
                        : `${comic.positionVerb} ${activity.pageIndex + 1} / ${activity.pageCount}`
                    }
                  />
                )}
              </>
            ) : (
              <>
                <Field
                  label="相册数量"
                  value={`${node.albumCount ?? 0} ${collectionUnit(node.contentKind)}`}
                />
                <Field label="直属项目" value={`${node.childCount ?? 0} 项`} />
              </>
            )}
            <Field
              label="媒体总数"
              value={`${node.mediaCount ?? (node.imageCount ?? 0) + (node.videoCount ?? 0)} 项`}
            />
            <Field label="大小" value={formatSize(node.folderSize ?? 0)} />
            <Field label="修改时间" value={formatDateTime(node.modTime)} />
            {!!node.tags?.length && (
              <Field label="标签" value={node.tags.join(" · ")} />
            )}
          </dl>
          <p className="text-caption text-ink-3">根据最近一次扫描记录展示。</p>
        </>
      )}
    </>
  );
}

function ImageProperties({ fileId }: { fileId: string }) {
  const { info, err, loading, refetch } = useImageInfo(fileId);
  return (
    <>
      {loading && (
        <p role="status" className="text-ink-2 text-caption">
          加载中…
        </p>
      )}
      {err && (
        <LoadError
          message="无法读取图片属性"
          retry={refetch}
          retrying={loading}
        />
      )}
      {info && (
        <dl className="divide-y divide-line">
          <Field label="文件名" value={info.name} copyable />
          <Field label="格式" value={info.format.toUpperCase()} />
          <Field label="尺寸" value={`${info.width} × ${info.height} px`} />
          <Field label="大小" value={formatSize(info.size)} />
          <Field label="修改时间" value={formatDateTime(info.mtime)} />
          <Field label="目录" value={info.dir} mono copyable />
          <Field label="校验和" value={info.checksum} mono copyable />
          <Field label="文件 ID" value={info.path} mono copyable />
        </dl>
      )}
    </>
  );
}

function LoadError({
  message,
  retry,
  retrying,
}: {
  message: string;
  retry: () => void;
  retrying: boolean;
}) {
  return (
    <ErrorBanner
      className="rounded-lg p-3 text-caption"
      onRetry={(event) => {
        // 重试会暂时移除错误提示，将焦点留在仍可操作的关闭按钮上。
        event.currentTarget
          .closest("dialog")
          ?.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')
          ?.focus({ preventScroll: true });
        retry();
      }}
      retrying={retrying}
    >
      {message}
    </ErrorBanner>
  );
}

function Field({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    /* 两列的规格表：标签在左一窄列，值在右。
       原先标签在上、值在下，八个字段把弹窗撑到近 600px 高，
       下面大半是空的；规格表本来就该横向扫读。 */
    <div className="flex items-start gap-4 py-1.5">
      <dt className="w-20 shrink-0 text-caption font-medium text-ink-2 leading-6">
        {label}
      </dt>
      <dd className="flex-1 min-w-0 flex items-start gap-1.5">
        <span
          className={`break-all leading-6 ${
            mono ? "font-mono text-caption text-ink-2" : "text-body"
          }`}
        >
          {value}
        </span>
        {copyable && (
          <span className="shrink-0 mt-1">
            <CopyButton value={value} title={`复制${label}`} />
          </span>
        )}
      </dd>
    </div>
  );
}
