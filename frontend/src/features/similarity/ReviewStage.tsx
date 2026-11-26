import { lazy, Suspense, useRef, useState } from "react";
import { similarityKindLabel } from "../../hooks/useSimilarity";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { RenditionImage } from "../common";
import type { SimilarityReview } from "./useSimilarityReview";
import { ReviewActions } from "./ReviewActions";
const PhotoViewer = lazy(() => import("../viewer/PhotoViewer"));

export function ReviewStage({ review }: { review: SimilarityReview }) {
  const group = review.active;
  const { groups, focusIndex } = review.state;
  const [opened, setOpened] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);
  if (!group) return null;
  const members = group.members;
  const filmstrip = members.length > 8;
  const focus = members[focusIndex];
  const position = groups.findIndex((item) => item.id === group.id);
  return (
    <section
      ref={stage}
      data-review-stage
      tabIndex={-1}
      aria-label="组内审阅"
      className="flex min-h-full flex-col gap-3 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-subheading">
            {similarityKindLabel(group.kind)} · {members.length} 张
          </h2>
          <p className="text-caption text-ink-3">
            {group.folder}
            {group.crossFolder && " · 跨文件夹"}
          </p>
        </div>
        <span className="flex items-center gap-2 text-caption tabular-nums">
          <Button
            size="sm"
            variant="ghost"
            disabled={position === 0}
            onClick={review.prev}
          >
            上一组
          </Button>
          {position + 1} / {review.source.page?.total ?? groups.length}
          <Button
            size="sm"
            variant="ghost"
            disabled={position >= groups.length - 1}
            onClick={review.next}
          >
            下一组
          </Button>
        </span>
      </header>
      {filmstrip && focus && (
        <button
          aria-label="查看聚焦照片"
          onClick={() => setOpened(group.id)}
          className="grid min-h-40 flex-1 place-items-center rounded-lg bg-sunken"
        >
          <RenditionImage
            fileId={focus.resourceId}
            alt={focus.albumName}
            displayWidth={800}
            className="max-h-[45dvh] max-w-full object-contain"
          />
        </button>
      )}
      <div
        aria-label="组内照片"
        className={
          filmstrip
            ? "flex gap-2 overflow-x-auto py-2"
            : "grid flex-1 grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] items-center gap-3"
        }
      >
        {members.map((member, i) => (
          <button
            key={member.resourceId}
            type="button"
            aria-label={`照片 ${i + 1}，${member.albumName}`}
            aria-pressed={i === focusIndex}
            title={member.albumName + " · " + member.resourceId}
            onClick={() => review.setFocus(i)}
            onDoubleClick={() => setOpened(group.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setOpened(group.id);
              }
            }}
            className={`relative min-w-0 rounded-lg bg-sunken text-left outline-offset-2 aria-pressed:ring-2 aria-pressed:ring-accent ${filmstrip ? "w-20 shrink-0" : ""}`}
          >
            <RenditionImage
              fileId={member.resourceId}
              alt=""
              displayWidth={filmstrip ? 80 : 640}
              className={
                filmstrip
                  ? "h-16 w-full rounded-lg object-cover"
                  : "h-[clamp(120px,30vh,400px)] w-full rounded-lg object-contain"
              }
            />
            {member.resourceId === group.representative && (
              <span className="absolute right-2 top-2">
                <Badge tone="accent" variant="solid">★ 代表</Badge>
              </span>
            )}
            {member.resourceId===group.recommended && !filmstrip && <span className="absolute bottom-9 left-2 rounded-sm bg-raised px-2 py-0.5 text-caption text-ink">建议保留</span>}
            {!filmstrip && (
              <span className="block p-2 text-caption tabular-nums text-ink-2">
                {i + 1} · 清晰 {Math.round(member.quality.sharpnessScore * 100)}{" "}
                · {member.quality.megapixels.toFixed(1)} MP · 曝光{" "}
                {Math.round(member.quality.exposureScore * 100)}
                
              </span>
            )}
          </button>
        ))}
      </div>
      <ReviewActions review={review} />
      {opened === group.id && focus && (
        <Suspense fallback={null}>
          <PhotoViewer
            items={members.map((member, i) => ({
              id: member.resourceId,
              kind: "image",
              name: member.albumName,
              index: i,
              kindIndex: i,
              width: member.width,
              height: member.height,
            }))}
            albumName={focus.albumName}
            index={focusIndex}
            onIndexChange={review.setFocus}
            onClose={() => {
              setOpened(null);
              requestAnimationFrame(() =>
                stage.current
                  ?.querySelector<HTMLElement>('[aria-pressed="true"]')
                  ?.focus(),
              );
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
