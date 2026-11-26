import type { ReactNode } from "react";

interface TravelStatsProps {
  /** 全库图片总数（不含视频）；null 表示还没取到。 */
  totalPhotos: number | null;
  /** 带位置的照片数；null 表示还没取到。 */
  gpsPhotos: number | null;
  /** 去过的省、市数；null 表示还没取到。 */
  provinces: number | null;
  cities: number | null;
  /** 没有可信拍摄时间的照片数；null 表示还没取到。 */
  untimed: number | null;
  /** 排在规模信息左边的控件（时间跨度筛选）。 */
  children?: ReactNode;
}

/**
 * 顶部的规模条。
 *
 * 一个主数字加一句补充，而不是一排同样大小的数字：全库有多少张照片是这
 * 一页的分母，带位置的、走过的地方、有多少张没时间，都是从这个分母
 * 里分出来的说法。主次分开，读者一眼知道先看哪个。
 *
 * 左端可以挂一个控件：跨度筛选管的是范围，规模管的是体量，两件事并成
 * 一行，不另起一条抬头。
 */
export default function TravelStats({
  totalPhotos,
  gpsPhotos,
  provinces,
  cities,
  untimed,
  children,
}: TravelStatsProps) {
  return (
    <div className="travel-stats flex flex-wrap items-baseline gap-y-1.5 gap-x-5 max-lg:gap-y-2.5">
      {children ? <div className="travel-stats__scope flex items-center self-center pr-5 border-r border-r-line max-lg:pr-0 max-lg:[border-right:none]">{children}</div> : null}
      <p className="travel-stats__hero flex items-baseline gap-2">
        <span className="travel-stats__hero-value font-display text-[30px] leading-[1.05] font-semibold tracking-[-0.02em] text-fg tabular-nums">
          {totalPhotos === null ? "—" : totalPhotos.toLocaleString()}
        </span>
        <span className="travel-stats__hero-label text-caption text-fg-muted">张照片 · 全库</span>
      </p>
      {/* 还没取到时一律写「—」：加载途中先摆一排 0，读的人会以为库里
          真的没有带位置的照片 —— 那是这一页最不该说错的一句。 */}
      <div className="travel-stats__rest flex flex-wrap items-baseline gap-y-[3px] gap-x-4 pl-5 border-l border-l-line text-body text-fg-muted">
        <span>
          <b className="travel-stats__value text-fg font-semibold tabular-nums">{count(gpsPhotos)}</b> 张带位置
        </span>
        <span>
          <b className="travel-stats__value text-fg font-semibold tabular-nums">{count(provinces)}</b> 个省
          <b className="travel-stats__value text-fg font-semibold tabular-nums ml-2">{count(cities)}</b> 个市
        </span>
        <span>
          <b className="travel-stats__value text-fg font-semibold tabular-nums">{count(untimed)}</b> 张没有拍摄时间
        </span>
      </div>
    </div>
  );
}

/** 数字还没到时写破折号，不写 0。 */
function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}
