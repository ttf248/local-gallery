import { type TimelineGroup } from "../../utils/timeline";

interface Props {
  /** 这一段的分组信息。 */
  group: TimelineGroup;
}

/**
 * 时间线上的一段标题：某年某月，或者「日期未知」。
 *
 * 标题要说清两件事：这一段是什么时候，以及这一段时间是怎么来的。
 *
 * 「2024 年 5 月」只是月份；后面那一句说明它是拍出来的还是推断出来的 ——
 * 从文件名或目录名推断出来的月份必须标出来，否则用户会以为这一段里
 * 每张照片都是那天拍的。
 */
export default function TimelineGroupHeader({ group }: Props) {
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
      data-testid="timeline-group-header"
    >
      <h2 className="font-display text-label font-semibold text-fg">
        {group.label}
      </h2>
      <span className="text-meta tabular-nums text-fg-subtle">
        {group.count} 张
      </span>
      {group.note ? (
        <span
          className="text-meta text-fg-subtle"
          data-testid="timeline-group-note"
        >
          · {group.note}
        </span>
      ) : null}
      {/* 标题后面一条细线：这一段的内容到这里为止。月份是时间线上的
          骨架，线把「这一段」与下一段分开，读的人一眼知道照片从哪
          开始、到哪结束。 */}
      <span className="section-rule" aria-hidden />
    </div>
  );
}
