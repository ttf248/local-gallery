import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  /** 这一项点进去去哪儿。 */
  to: string;
  /** 标题：人名、地名、主题名。 */
  title: string;
  /**
   * 画面。
   *
   * 优先给真实照片：人物给代表脸，地点给真实的地理照片，主题给实际
   * 成员封面。实在没有照片时给一块说明「这里本来就没有照片」的底 ——
   * 一块空白方框会被读成加载失败的图片。
   */
  media: ReactNode;
  /** 标题下的一行：张数、来源、去过的次数。 */
  meta?: ReactNode;
  /** 悬停提示（例如主题是靠什么线索聚起来的）。 */
  hint?: string;
  testId?: string;
}

/**
 * 发现卡：发现页四段预览共用的卡片。
 *
 * 时间、人物、地点、主题以前各用一套排法，一屏里四种节奏，读的人得先
 * 认一遍版式才知道每段摆的是什么。现在四段共用这一张卡：一样的方块
 * 画面、一样的标题与说明位置。卡片之间靠留白与细线分开，不靠白底盒子。
 */
export default function ExploreCard({
  to,
  title,
  media,
  meta,
  hint,
  testId,
}: Props) {
  return (
    <Link
      to={to}
      className="explore-card"
      title={hint}
      data-testid={testId}
    >
      <span className="explore-card__media">{media}</span>
      <span className="explore-card__title">{title}</span>
      {meta ? <span className="explore-card__meta">{meta}</span> : null}
    </Link>
  );
}
