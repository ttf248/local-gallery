import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Menu } from "../../ui/Menu";
import { MoreHorizontalIcon } from "../../ui/icons";
import { useMemo } from "react";
import { ThumbImage } from "../common";
import {
  similarityKindHint,
  similarityKindLabel,
  similarityStatusLabel,
} from "../../hooks/useSimilarity";
import type { SimilarityGroup, SimilarityMember } from "../../api/similarity";

interface Props {
  group: SimilarityGroup;
  expanded: boolean;
  onToggleExpand: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  onSetRepresentative: (resourceId: string) => void;
  onReview: () => void;
  onIgnore: () => void;
  onPick: () => void;
  onCompare: (leftId: string, rightId: string) => void;
  busy?: boolean;
}

/**
 * 一组相似照片。
 *
 * 这一组是「一个决定」而不是「一面墙」：用户看完这一组，要能说出
 * 留哪张、其余算不算重复。因此代表照片摆在最左边，占据第一眼；
 * 其余成员收在展开区里并排摆着，方便逐张比对。
 *
 * 三类结果的徽章写在标题行上，字面说清是哪种重复 ——
 * 把连拍说成「重复」是最容易出的错。
 */
export default function SimilarityGroupCard({
  group,
  expanded,
  onToggleExpand,
  selected,
  onToggleSelect,
  onSetRepresentative,
  onReview,
  onIgnore,
  onPick,
  onCompare,
  busy = false,
}: Props) {
  const representative = useMemo(
    () =>
      group.members.find(
        (member) => member.resourceId === group.representative,
      ),
    [group],
  );
  const recommended = useMemo(
    () =>
      group.members.find((member) => member.resourceId === group.recommended),
    [group],
  );
  return (
    <article
      className="relative border-b border-line py-6"
      data-testid="similarity-group"
      data-group-id={group.id}
      data-group-kind={group.kind}
      data-group-status={group.status}
    >
      <div className="grid min-w-0 items-start gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <label
          className="absolute right-1 top-6 z-10 grid size-11 cursor-pointer place-items-center"
          title="选中这一组"
        >
          <input
            type="checkbox" className="size-5 accent-accent"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`选中这一组（${similarityKindLabel(group.kind)}）`}
          />

        </label>

        <button
          type="button"
          className="relative w-[min(100%,200px)] overflow-hidden rounded-lg"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"}这一组的 ${group.members.length} 张照片`}
        >
          {group.recommended === group.representative && (
            <Badge tone="success" className="absolute left-2 top-2 z-10">
              建议保留
            </Badge>
          )}
          <ThumbImage
            fileId={group.representative}
            alt="代表照片"
            className="aspect-square w-full object-cover"
            displayWidth={200}
          />
        </button>

        <div className="similarity-group__body [flex:1_1_260px] min-w-0 [align-self:flex-start]">
          <div className="similarity-group__text min-w-0">
            <div className="similarity-group__title flex items-center gap-2 flex-wrap">
              <Badge title={similarityKindHint(group.kind)}>
                {similarityKindLabel(group.kind)}
              </Badge>
              <span className="similarity-group__count text-[var(--text-caption,var(--text-body))] text-ink-2">
                {group.members.length} 张
              </span>
              {group.redundant > 0 ? (
                <span className="similarity-group__count text-[var(--text-caption,var(--text-body))] text-ink-2">
                  多余 {group.redundant} 张
                </span>
              ) : null}
              {group.crossFolder ? (
                <span
                  className="similarity-group__count text-[var(--text-caption,var(--text-body))] text-ink-2"
                  title="这一组的照片分散在多个文件夹"
                >
                  跨文件夹
                </span>
              ) : null}
              <Badge tone={group.status === "reviewed" ? "success" : "neutral"}>
                {similarityStatusLabel(group.status)}
              </Badge>
            </div>

            <div className="similarity-group__meta flex items-center gap-1.5 mt-1 text-[var(--text-caption,var(--text-body))] text-ink-3 min-w-0">
              <span className="truncate" title={group.folder}>
                {group.folder}
              </span>
              {group.timeSpanMs > 0 ? (
                <span>· 跨度 {formatSimilaritySpan(group.timeSpanMs)}</span>
              ) : null}
              {group.timeSource === "file" ? (
                <span title="这组照片没有拍摄时间，用的是文件修改时间">
                  · 文件时间
                </span>
              ) : null}
            </div>

            {/* 质量读数退到次级排版：它解释「为什么是这张」，不是这一组
                的主角。主角是照片与那个决定 —— 读数压在下面一行小字里，
                眼睛先看到的是图，再往下扫到依据。 */}
            {representative ? (
              <div className="similarity-group__quality flex items-center gap-2.5 flex-wrap mt-1.5 text-[var(--text-caption,var(--text-body))] text-ink-3">
                <span className="similarity-group__quality-label text-ink-3">
                  {group.representativeIsManual ? "当前代表" : "建议代表"}
                </span>
                <SimilarityQualityReadout quality={representative.quality} />
                {group.representativeIsManual && recommended ? (
                  <span className="similarity-group__hint text-ink-3">
                    建议的是另一张（清晰度{" "}
                    {Math.round(recommended.quality.sharpnessScore * 100)}）
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div
            className="my-3 flex max-w-full gap-2 overflow-x-auto"
            aria-label="组内照片"
          >
            {(expanded ? group.members : group.members.slice(0, 8)).map(
              (member) =>
                expanded ? (
                  <MemberTile
                    key={member.resourceId}
                    member={member}
                    group={group}
                    onSetRepresentative={onSetRepresentative}
                    onCompare={onCompare}
                  />
                ) : (
                  <button
                    key={member.resourceId}
                    type="button"
                    aria-label={"展开成员：" + (member.albumName || "照片")}
                    onClick={onToggleExpand}
                    className="shrink-0"
                  >
                    <ThumbImage
                      fileId={member.resourceId}
                      alt=""
                      displayWidth={140}
                      className="h-[120px] w-[120px] rounded-md object-cover"
                    />
                  </button>
                ),
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={(event) => {
                const card = event.currentTarget.closest("article");
                if (
                  !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
                )
                  card?.animate?.([{ opacity: 1 }, { opacity: 0.25 }], {
                    duration: 200,
                  });
                onReview();
              }}
            >
              {group.status === "reviewed" ? "放回待处理" : "标记已处理"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggleExpand}
              aria-expanded={expanded}
            >
              {expanded ? "收起" : "展开"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onPick}>
              加入精选
            </Button>
            <Menu
              label="更多组操作"
              align="end"
              trigger={
                <Button size="sm" variant="ghost" aria-label="更多组操作">
                  <MoreHorizontalIcon />
                </Button>
              }
              items={[
                {
                  id: "ignore",
                  label: group.status === "ignored" ? "取消忽略" : "忽略",
                  disabled: busy,
                  onSelect: onIgnore,
                },
                {
                  id: "representative",
                  label: "更换代表照片",
                  disabled: expanded,
                  onSelect: onToggleExpand,
                },
              ]}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * 展开区里的一张成员。
 *
 * 点照片就是「把它当代表」；旁边那枚按钮才是并排对比 ——
 * 两个动作长得不一样，才不会点错。
 */
function MemberTile({
  member,
  group,
  onSetRepresentative,
  onCompare,
}: {
  member: SimilarityMember;
  group: SimilarityGroup;
  onSetRepresentative: (resourceId: string) => void;
  onCompare: (leftId: string, rightId: string) => void;
}) {
  const isRepresentative = member.resourceId === group.representative;
  const isRecommended = member.resourceId === group.recommended;
  return (
    <div
      className={`similarity-member flex flex-col gap-2 p-2 rounded-tile bg-sunken min-w-0${isRepresentative ? " similarity-member--current [box-shadow:inset_0_0_0_2px_var(--ink)]" : ""}`}
      style={{ width: 180, flexShrink: 0 }}
      data-testid="similarity-member"
    >
      <button
        type="button"
        className="similarity-member__image relative block w-full rounded-sm overflow-hidden bg-sunken-strong cursor-pointer focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]"
        onClick={() => onSetRepresentative(member.resourceId)}
        title="把这张设为代表照片"
        aria-pressed={isRepresentative}
        aria-label={`把这张设为代表照片（${member.albumName || "照片"}）`}
      >
        <ThumbImage
          fileId={member.resourceId}
          alt="组内照片"
          className="similarity-member__thumb block w-full h-[180px] object-cover"
          displayWidth={220}
        />
        {isRepresentative ? (
          <span className="similarity-member__flag absolute left-1.5 top-1.5 py-0.5 px-[7px] rounded-tile text-caption [background:rgb(0_0_0_/_0.72)] [color:#fff] [backdrop-filter:blur(4px)]">代表</span>
        ) : null}
        {isRecommended && !isRepresentative ? (
          <span className="similarity-member__flag absolute left-1.5 top-1.5 py-0.5 px-[7px] rounded-tile text-caption [background:rgb(0_0_0_/_0.72)] [color:#fff] [backdrop-filter:blur(4px)] similarity-member__flag--quiet [background:rgb(0_0_0_/_0.5)] [color:rgb(255_255_255_/_0.85)]">
            建议
          </span>
        ) : null}
      </button>
      <div className="similarity-member__meta flex flex-col gap-[3px] min-w-0 text-[var(--text-caption,var(--text-body))] text-ink-2">
        <span className="truncate" title={member.albumName}>
          {member.albumName || "照片"}
        </span>
        <SimilarityQualityReadout quality={member.quality} />
        <span className="similarity-member__distance text-ink-3 tabular-nums">
          {group.kind === "exact"
            ? "内容一致"
            : group.kind === "burst"
              ? `相似 ${Math.round(member.similarity * 100)}%`
              : `哈希距离 ${member.distance}`}
        </span>
      </div>
      {group.members.length > 1 ? (
        <button
          type="button"
          className="btn btn-sm similarity-member__compare [align-self:flex-start]"
          onClick={() => onCompare(group.representative, member.resourceId)}
          disabled={isRepresentative}
          title={isRepresentative ? "这张已经是代表照片" : "与代表照片并排对比"}
        >
          对比
        </button>
      ) : null}
    </div>
  );
}

/** 质量分项：三个可解释的数字，而不是一个黑箱总分。 */
function SimilarityQualityReadout({
  quality,
}: {
  quality: SimilarityGroup["members"][number]["quality"];
}) {
  return (
    <span className="similarity-quality inline-flex items-center gap-2 text-[var(--text-caption,var(--text-body))] text-ink-2 tabular-nums">
      <span title="清晰度分项">
        清晰 {Math.round(quality.sharpnessScore * 100)}
      </span>
      <span title="分辨率分项">
        {quality.megapixels >= 0.1
          ? `${quality.megapixels.toFixed(1)}MP`
          : "分辨率偏低"}
      </span>
      <span title="曝光分项">
        曝光 {Math.round(quality.exposureScore * 100)}
      </span>
    </span>
  );
}

/** 时间跨度的说法。 */
function formatSimilaritySpan(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${(minutes / 60).toFixed(1)} 小时`;
}
