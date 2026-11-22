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
 *
 * 层级靠字号与字重分，不靠颜色：月份是这一段的骨架，张数与说明退到
 * 一档 —— 张数与标题并排时用同样大的字，两边谁也不让谁，读的人
 * 反而不知道该看哪个。
 */
export default function TimelineGroupHeader({ group }: Props) {
  return (
    <div
      className="timeline-group flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
      data-testid="timeline-group-header"
    >
      <h2 className="timeline-group__title">{group.label}</h2>
      <span className="timeline-group__count tabular-nums">
        {group.count} 张
      </span>
      {group.note ? (
        <span
          className="timeline-group__note"
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
