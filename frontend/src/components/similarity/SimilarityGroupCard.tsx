import { useMemo } from "react";
import ThumbImage from "../common/ThumbImage";
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
    () => group.members.find((member) => member.resourceId === group.representative),
    [group],
  );
  const recommended = useMemo(
    () => group.members.find((member) => member.resourceId === group.recommended),
    [group],
  );
  return (
    <article
      className="similarity-group"
      data-testid="similarity-group"
      data-group-id={group.id}
      data-group-kind={group.kind}
      data-group-status={group.status}
    >
      <div className="similarity-group__head">
        <label className="similarity-group__check" title="选中这一组">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`选中这一组（${similarityKindLabel(group.kind)}）`}
          />
          <span
            className="similarity-group__checkbox-mark"
            aria-hidden="true"
          />
        </label>

        <button
          type="button"
          className="similarity-group__hero"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"}这一组的 ${group.members.length} 张照片`}
        >
          <ThumbImage
            fileId={group.representative}
            alt="代表照片"
            className="similarity-group__hero-image"
            displayWidth={168}
          />
        </button>

        <div className="similarity-group__body">
          <div className="similarity-group__text">
            <div className="similarity-group__title">
              <span className="similarity-group__kind" title={similarityKindHint(group.kind)}>
                {similarityKindLabel(group.kind)}
              </span>
              <span className="similarity-group__count">{group.members.length} 张</span>
              {group.redundant > 0 ? (
                <span className="similarity-group__count">多余 {group.redundant} 张</span>
              ) : null}
              {group.crossFolder ? (
                <span className="similarity-group__count" title="这一组的照片分散在多个文件夹">
                  跨文件夹
                </span>
              ) : null}
              <span
                className={`similarity-group__status similarity-group__status--${group.status}`}
              >
                {similarityStatusLabel(group.status)}
              </span>
            </div>

            <div className="similarity-group__meta">
              <span className="truncate" title={group.folder}>
                {group.folder}
              </span>
              {group.timeSpanMs > 0 ? (
                <span>· 跨度 {formatSimilaritySpan(group.timeSpanMs)}</span>
              ) : null}
              {group.timeSource === "file" ? (
                <span title="这组照片没有拍摄时间，用的是文件修改时间">· 文件时间</span>
              ) : null}
            </div>

            {/* 质量读数退到次级排版：它解释「为什么是这张」，不是这一组
                的主角。主角是照片与那个决定 —— 读数压在下面一行小字里，
                眼睛先看到的是图，再往下扫到依据。 */}
            {representative ? (
              <div className="similarity-group__quality">
                <span className="similarity-group__quality-label">
                  {group.representativeIsManual ? "当前代表" : "建议代表"}
                </span>
                <SimilarityQualityReadout quality={representative.quality} />
                {group.representativeIsManual && recommended ? (
                  <span className="similarity-group__hint">
                    建议的是另一张（清晰度 {Math.round(recommended.quality.sharpnessScore * 100)}）
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="similarity-group__actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onToggleExpand}
            aria-expanded={expanded}
          >
            {expanded ? "收起" : "展开"}
          </button>
          <button type="button" className="btn btn-sm" onClick={onPick} disabled={busy}>
            加入精选
          </button>
          {/* 这一组的正事就是「处理掉」：它比另外两个动作重一档。
              不用强调色实底 —— 一屏几十组，实底按钮会变成一片色块；
              一圈细线就够把它从「展开」「加入精选」里挑出来。 */}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={onReview}
            disabled={busy}
          >
            {group.status === "reviewed" ? "放回待处理" : "标记已处理"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onIgnore}
            disabled={busy}
          >
            {group.status === "ignored" ? "取消忽略" : "忽略"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="similarity-group__members">
          {group.members.map((member) => (
            <MemberTile
              key={member.resourceId}
              member={member}
              group={group}
              onSetRepresentative={onSetRepresentative}
              onCompare={onCompare}
            />
          ))}
        </div>
      ) : null}
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
      className={`similarity-member${isRepresentative ? " similarity-member--current" : ""}`}
      data-testid="similarity-member"
    >
      <button
        type="button"
        className="similarity-member__image"
        onClick={() => onSetRepresentative(member.resourceId)}
        title="把这张设为代表照片"
        aria-pressed={isRepresentative}
        aria-label={`把这张设为代表照片（${member.albumName || "照片"}）`}
      >
        <ThumbImage
          fileId={member.resourceId}
          alt="组内照片"
          className="similarity-member__thumb"
          displayWidth={220}
        />
        {isRepresentative ? (
          <span className="similarity-member__flag">代表</span>
        ) : null}
        {isRecommended && !isRepresentative ? (
          <span className="similarity-member__flag similarity-member__flag--quiet">
            建议
          </span>
        ) : null}
      </button>
      <div className="similarity-member__meta">
        <span className="truncate" title={member.albumName}>
          {member.albumName || "照片"}
        </span>
        <SimilarityQualityReadout quality={member.quality} />
        <span className="similarity-member__distance">
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
          className="btn btn-sm similarity-member__compare"
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
    <span className="similarity-quality">
      <span title="清晰度分项">清晰 {Math.round(quality.sharpnessScore * 100)}</span>
      <span title="分辨率分项">
        {quality.megapixels >= 0.1
          ? `${quality.megapixels.toFixed(1)}MP`
          : "分辨率偏低"}
      </span>
      <span title="曝光分项">曝光 {Math.round(quality.exposureScore * 100)}</span>
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
