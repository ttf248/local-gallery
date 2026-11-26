import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import EmptyState from "../components/common/EmptyState";
import {PageHeader} from "../shell/PageHeader";
import RenditionImage from "../components/common/RenditionImage";
import {
  peopleAnnotationsApi,
  type PeopleAnnotationFace,
  type PeopleAnnotationIdentity,
  type PeopleAnnotationSample,
} from "../api/peopleAnnotations";
import { useUIStore } from "../store/uiStore";
import { pickRenditionWidth } from "../utils/rendition";
import { thumbUrl } from "../api/thumbs";
import { peopleRoute } from "../utils/path";

/**
 * 标注工作台里的一张脸。
 *
 * id 只是这一次编辑里的稳定句柄：保存时只提交身份、框与来源，
 * 服务端不关心它。
 */
interface WorkingFace {
  id: string;
  identity: string;
  box: [number, number, number, number];
  source: "detected" | "manual";
  smallFace?: boolean;
}

const REASON_LABELS: Record<string, string> = {
  pendingMatch: "待确认匹配",
  groupPhoto: "合照候选",
  lowQuality: "低质量分组",
};

const SCENARIO_LABELS: Record<string, string> = {
  crossAge: "跨年龄",
  profile: "侧脸",
  lowQuality: "低清晰度",
  groupPhoto: "大合照",
  backlit: "逆光",
  occluded: "遮挡",
  unreviewed: "未复核",
};

export default function PeopleAnnotate() {
  const client = useQueryClient();
  const pushToast = useUIStore((state) => state.pushToast);
  const [selectedID, setSelectedID] = useState<string>("");
  const samples = useQuery({
    queryKey: ["people-annotation-samples"],
    queryFn: () => peopleAnnotationsApi.samples(),
  });
  const identities = useQuery({
    queryKey: ["people-annotation-identities"],
    queryFn: () => peopleAnnotationsApi.identities(),
  });
  const resample = useMutation({
    mutationFn: () => peopleAnnotationsApi.samples(true),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["people-annotation-samples"] });
      pushToast({ kind: "success", message: "已重新抽取标注样本" });
    },
    onError: () => pushToast({ kind: "error", message: "重新抽样失败" }),
  });
  const createIdentity = useMutation({
    mutationFn: (label: string) => peopleAnnotationsApi.createIdentity(label),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["people-annotation-identities"] });
    },
    onError: () => pushToast({ kind: "error", message: "创建身份失败" }),
  });

  const items = useMemo(() => samples.data?.items ?? [], [samples.data]);
  const activeID = selectedID || items[0]?.resourceId || "";
  const progress = samples.data?.progress;

  useEffect(() => {
    if (selectedID && items.some((item) => item.resourceId === selectedID)) return;
    setSelectedID(items[0]?.resourceId ?? "");
  }, [items, selectedID]);

  const handleCreateIdentity = useCallback(
    async (label: string) => {
      const result = await createIdentity.mutateAsync(label);
      return result.identity;
    },
    [createIdentity],
  );

  return (
    <div className="h-full overflow-y-auto pb-12">
      <div className="page-shell"><PageHeader
  eyebrow="离线智能相册 · 本机工具"
  title="人物标注"
  meta="给真实照片里的人脸标上匿名身份，用来衡量检测与分组的实际效果。标注只保存在本机，不会改写人物分组、命名或原始照片。"
  actions={
          <Link className="btn btn-sm btn-outline" to={peopleRoute()}>
            回到人物相册
          </Link>
        }
/></div>
      {samples.isError ? (
        <section className="page-shell mt-6">
          <EmptyState
            title="标注工作台不可用"
            description="这个工具只能在运行服务的本机打开。局域网访问时服务端会拒绝这些请求。"
            action={
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void samples.refetch()}
              >
                重新加载
              </button>
            }
          />
        </section>
      ) : (
        <section className="page-shell mt-6 grid gap-6 lg:grid-cols-[minmax(240px,0.6fr)_minmax(0,1.8fr)]">
          <aside className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-label text-fg">待标注样本</h2>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={resample.isPending}
                onClick={() => resample.mutate()}
              >
                {resample.isPending ? "抽样中…" : "重新抽样"}
              </button>
            </div>
            {progress ? (
              <p className="text-meta text-fg-muted">
                已复核 {progress.reviewedCount}/{progress.sampleCount} 张 ·{" "}
                {progress.annotatedPhotoCount} 张已标注 ·{" "}
                {progress.faceCount} 张脸 · {progress.identityCount} 个匿名身份
              </p>
            ) : null}
            <ul className="space-y-2">
              {items.map((item) => (
                <SampleRow
                  key={item.resourceId}
                  sample={item}
                  active={item.resourceId === activeID}
                  onSelect={() => setSelectedID(item.resourceId)}
                />
              ))}
            </ul>
            {items.length === 0 && !samples.isLoading ? (
              <EmptyState
                title="没有可标注的样本"
                description="先在人物相册里跑一次人脸分析，再回来抽样。"
                dense
              />
            ) : null}
            <a
              className="btn btn-sm btn-outline"
              href={peopleAnnotationsApi.datasetUrl()}
              download
            >
              导出评测集
            </a>
            <p className="text-meta text-fg-subtle">
              导出的是 schemaVersion=1 的本地标注集，可直接交给
              evaluate_people.py 比较不同模型与检测方式。
            </p>
          </aside>
          <div className="min-w-0">
            {activeID ? (
              <AnnotationEditor
                key={activeID}
                resourceID={activeID}
                identities={identities.data?.items ?? []}
                scenarioTags={samples.data?.scenarioTags ?? []}
                onCreateIdentity={handleCreateIdentity}
                onSaved={async () => {
                  await client.invalidateQueries({
                    queryKey: ["people-annotation-samples"],
                  });
                }}
              />
            ) : (
              <EmptyState
                title="先选一张照片"
                description="左边选一张待标注的照片开始。"
                dense
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function SampleRow({
  sample,
  active,
  onSelect,
}: {
  sample: PeopleAnnotationSample;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
          active
            ? "border-border-strong bg-bg-elevated"
            : "border-border-faint hover:border-border-strong"
        }`}
      >
        <span className="h-14 w-14 shrink-0 overflow-hidden rounded bg-bg-subtle">
          <RenditionImage
            fileId={sample.resourceId}
            alt=""
            displayWidth={128}
            className="h-full w-full object-cover"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-fg">
            {REASON_LABELS[sample.reason] ?? sample.reason}
          </span>
          <span className="mt-0.5 block text-meta text-fg-muted">
            {sample.faceCount} 张脸
            {sample.personName ? ` · ${sample.personName}` : ""}
          </span>
          <span className="mt-0.5 block text-meta text-fg-subtle">
            {sample.reviewed
              ? "已复核"
              : sample.identities?.length
                ? `已标 ${sample.identities.length} 个身份`
                : "未标注"}
          </span>
        </span>
      </button>
    </li>
  );
}

function AnnotationEditor({
  resourceID,
  identities,
  scenarioTags,
  onCreateIdentity,
  onSaved,
}: {
  resourceID: string;
  identities: PeopleAnnotationIdentity[];
  scenarioTags: string[];
  onCreateIdentity: (label: string) => Promise<PeopleAnnotationIdentity>;
  onSaved: () => Promise<void>;
}) {
  const pushToast = useUIStore((state) => state.pushToast);
  const photo = useQuery({
    queryKey: ["people-annotation-photo", resourceID],
    queryFn: () => peopleAnnotationsApi.photo(resourceID),
  });
  const [faces, setFaces] = useState<WorkingFace[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [selectedFaceID, setSelectedFaceID] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const detail = photo.data?.photo;
  const width = detail?.width ?? 0;
  const height = detail?.height ?? 0;

  useEffect(() => {
    if (!detail) return;
    const annotation = detail.annotation;
    if (annotation) {
      setFaces(
        annotation.faces.map((face, index) => ({
          id: `a${index}`,
          identity: face.identity,
          box: face.box,
          source: face.source ?? "detected",
          smallFace: face.smallFace,
        })),
      );
      setTags(annotation.tags);
      setReviewed(annotation.reviewed);
      return;
    }
    setFaces(
      detail.detected.map((face) => ({
        id: `d${face.faceIndex}`,
        identity: "",
        box: face.box,
        source: "detected" as const,
      })),
    );
    setTags([]);
    setReviewed(false);
  }, [detail]);

  const save = useMutation({
    mutationFn: () =>
      peopleAnnotationsApi.save({
        resourceId: resourceID,
        tags,
        faces: faces.map<PeopleAnnotationFace>((face) => ({
          identity: face.identity,
          box: face.box,
          smallFace: face.smallFace,
          source: face.source,
        })),
        reviewed,
      }),
    onSuccess: async () => {
      await onSaved();
      pushToast({ kind: "success", message: "标注已保存到本机" });
    },
    onError: () => pushToast({ kind: "error", message: "保存标注失败" }),
  });

  const labelled = faces.filter((face) => face.identity).length;

  const toSourcePoint = useCallback(
    (event: React.PointerEvent) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0 || width <= 0) {
        return null;
      }
      return {
        x: ((event.clientX - rect.left) / rect.width) * width,
        y: ((event.clientY - rect.top) / rect.height) * height,
      };
    },
    [width, height],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!drawing) return;
    const point = toSourcePoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setDragEnd(point);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drawing || !dragStart) return;
    const point = toSourcePoint(event);
    if (!point) return;
    setDragEnd(point);
  };

  const handlePointerUp = () => {
    if (!drawing || !dragStart || !dragEnd) {
      setDragStart(null);
      setDragEnd(null);
      return;
    }
    const left = Math.min(dragStart.x, dragEnd.x);
    const top = Math.min(dragStart.y, dragEnd.y);
    const boxWidth = Math.abs(dragEnd.x - dragStart.x);
    const boxHeight = Math.abs(dragEnd.y - dragStart.y);
    setDragStart(null);
    setDragEnd(null);
    setDrawing(false);
    if (boxWidth < 4 || boxHeight < 4) return;
    const box: [number, number, number, number] = [left, top, boxWidth, boxHeight];
    setFaces((current) => {
      const selected = current.find((face) => face.id === selectedFaceID);
      if (selected) {
        // 选中了某张脸再画框，就是在纠正它。
        return current.map((face) =>
          face.id === selectedFaceID ? { ...face, box, source: "manual" as const } : face,
        );
      }
      return [
        ...current,
        {
          id: `m${current.length}-${Math.round(left)}`,
          identity: "",
          box,
          source: "manual" as const,
        },
      ];
    });
  };

  const assignIdentity = (faceID: string, identity: string) => {
    setFaces((current) =>
      current.map((face) => (face.id === faceID ? { ...face, identity } : face)),
    );
  };

  const toggleTag = (tag: string) => {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((value) => value !== tag)
        : [...current, tag],
    );
  };

  const previewBox = useMemo(() => {
    if (!dragStart || !dragEnd) return null;
    return {
      left: Math.min(dragStart.x, dragEnd.x),
      top: Math.min(dragStart.y, dragEnd.y),
      width: Math.abs(dragEnd.x - dragStart.x),
      height: Math.abs(dragEnd.y - dragStart.y),
    };
  }, [dragStart, dragEnd]);

  if (photo.isError) {
    return (
      <EmptyState
        title="照片加载失败"
        description="请确认照片仍在媒体库中。"
        action={
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void photo.refetch()}
          >
            重新加载
          </button>
        }
      />
    );
  }
  if (!detail) {
    return <EmptyState title="加载中…" description="正在读取这张照片的检测结果。" dense />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-label text-fg">标注这张照片</h2>
          <p
            className="mt-1 text-meta text-fg-muted"
            data-testid="people-annotate-summary"
          >
            检出 {detail.detected.length} 张脸 · 已标身份 {labelled} 张
            {width > 0 && height > 0 ? ` · 原图 ${width}×${height}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`btn btn-sm ${drawing ? "btn-primary" : "btn-outline"}`}
            onClick={() => setDrawing((value) => !value)}
          >
            {drawing ? "正在画框…" : "画框补检 / 纠正"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setReviewed((value) => !value)}
          >
            {reviewed ? "取消复核标记" : "标记已复核"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "保存中…" : "保存标注"}
          </button>
        </div>
      </div>

      <div
        ref={surfaceRef}
        className={`relative w-full select-none overflow-hidden rounded-lg bg-bg-subtle ${
          drawing ? "cursor-crosshair" : ""
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          src={thumbUrl(resourceID, undefined, pickRenditionWidth(1200))}
          alt=""
          className="block h-auto w-full"
          draggable={false}
        />
        {faces.map((face) => {
          const style = faceBoxStyle(face.box, width, height);
          if (!style) return null;
          const active = face.id === selectedFaceID;
          return (
            <button
              key={face.id}
              type="button"
              aria-label={`人脸 ${face.id}`}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedFaceID(active ? "" : face.id);
              }}
              className={`absolute rounded border-2 ${
                active
                  ? "border-accent shadow-[0_0_0_3px_var(--overlay-bg)]"
                  : face.identity
                    ? "border-white shadow-[0_0_0_2px_var(--overlay-bg)]"
                    : "border-danger/80"
              }`}
              style={style}
            />
          );
        })}
        {previewBox ? (
          <span
            aria-hidden="true"
            className="absolute rounded border-2 border-accent"
            style={
              faceBoxStyle(
                [
                  previewBox.left,
                  previewBox.top,
                  previewBox.width,
                  previewBox.height,
                ],
                width,
                height,
              ) ?? undefined
            }
          />
        ) : null}
      </div>
      {drawing ? (
        <p className="text-meta text-fg-muted">
          在照片上按住拖动画出人脸框。先选中一张脸再画框，就是纠正那张脸的检测框。
        </p>
      ) : null}

      <div>
        <h3 className="font-display text-label text-fg">人脸与身份</h3>
        <ul className="mt-2 space-y-2">
          {faces.map((face) => (
            <li
              key={face.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border-faint p-2"
            >
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() =>
                  setSelectedFaceID(face.id === selectedFaceID ? "" : face.id)
                }
              >
                {face.source === "manual" ? "补检" : "检出"}框
              </button>
              <span className="text-meta text-fg-muted">
                {Math.round(face.box[2])}×{Math.round(face.box[3])} px
              </span>
              <IdentityPicker
                identities={identities}
                value={face.identity}
                onChange={(identity) => assignIdentity(face.id, identity)}
                onCreate={onCreateIdentity}
              />
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() =>
                  setFaces((current) =>
                    current.filter((item) => item.id !== face.id),
                  )
                }
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        {faces.length === 0 ? (
          <p className="mt-2 text-meta text-fg-muted">
            这张照片没有检出人脸。若确实有人，用「画框补检」手动补一个。
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="font-display text-label text-fg">拍摄场景</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {scenarioTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tags.includes(tag)}
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-3 py-1.5 text-meta transition-colors ${
                tags.includes(tag)
                  ? "border-border-strong bg-bg-elevated text-fg"
                  : "border-border-faint text-fg-muted hover:text-fg"
              }`}
            >
              {SCENARIO_LABELS[tag] ?? tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function IdentityPicker({
  identities,
  value,
  onChange,
  onCreate,
}: {
  identities: PeopleAnnotationIdentity[];
  value: string;
  onChange: (identity: string) => void;
  onCreate: (label: string) => Promise<PeopleAnnotationIdentity>;
}) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");

  if (creating) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <input
          className="w-36 rounded-md border border-border bg-bg-elevated px-2 py-1 text-body text-fg"
          value={label}
          maxLength={40}
          placeholder="编号或备注"
          aria-label="匿名身份备注"
          onChange={(event) => setLabel(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={async () => {
            const identity = await onCreate(label);
            onChange(identity.id);
            setCreating(false);
            setLabel("");
          }}
        >
          创建
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => setCreating(false)}
        >
          取消
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-body text-fg"
        value={value}
        aria-label="匿名身份"
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">未标注身份</option>
        {identities.map((identity) => (
          <option key={identity.id} value={identity.id}>
            {identity.label ? `${identity.id} · ${identity.label}` : identity.id}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        onClick={() => setCreating(true)}
      >
        新建身份
      </button>
    </span>
  );
}

/**
 * 把原图像素坐标的框换算成相对照片的百分比。
 *
 * 照片按原比例铺满容器宽度，因此百分比换算与显示尺寸无关。
 */
function faceBoxStyle(
  box: [number, number, number, number],
  width: number,
  height: number,
): React.CSSProperties | null {
  if (width <= 0 || height <= 0) return null;
  const [x, y, boxWidth, boxHeight] = box;
  if (boxWidth <= 0 || boxHeight <= 0) return null;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(width, x + boxWidth);
  const bottom = Math.min(height, y + boxHeight);
  if (right <= left || bottom <= top) return null;
  return {
    left: `${(left / width) * 100}%`,
    top: `${(top / height) * 100}%`,
    width: `${((right - left) / width) * 100}%`,
    height: `${((bottom - top) / height) * 100}%`,
  };
}
