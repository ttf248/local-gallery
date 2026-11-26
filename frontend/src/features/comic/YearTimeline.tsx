import { useMemo, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { useListFilters } from "../../hooks/useListFilters";
import { useAppMode } from "../../hooks/useAppMode";
import type { TimelineYear } from "../../api/library";
import type { YearGroup } from "../../utils/albumGrouping";
import { albumCountUnit } from "../../utils/workbench";
import { yearRoute } from "../../utils/path";
import { FilterIcon } from "../../ui/icons";
import Timeline, { type TimelineEntry } from "./Timeline";

interface Props {
  groups?: YearGroup[];
  /**
   * 时间线按单张媒体日期统计的年份。传入时卡片显示这套计数，点击进入
   * /photo?year=YYYY；不与相册目录年份混用。
   */
  timelineYears?: TimelineYear[];
  gridRef?: RefObject<HTMLDivElement>;
  /**
   * 是否给出「只筛这一年」的那枚漏斗。
   *
   * 漏斗筛的是下方那张网格。照片侧的首页不再列全部图像（那一块换成
   * 智能相册），漏斗就没有可筛的对象 —— 年卡的主操作本来就直接进
   * 那一年，漏斗只是多一个没有去处的动作。
   */
  showFilter?: boolean;
}

/**
 * 年份索引。
 *
 * 点年份卡：照片侧直接看这一年的照片 —— 一年散在好几本相册里，
 * 先挑一本再进去等于让用户替系统做取舍。漫画侧仍进那一年的作品集。
 * 卡片右上角的漏斗才是「只筛这一年」—— 它筛的是下方网格。
 */
export default function YearTimeline({
  groups = [],
  timelineYears,
  gridRef,
  showFilter = true,
}: Props) {
  const navigate = useNavigate();
  const { yearFilter, toggleYearFilter: toggleYear } = useListFilters();
  // 计数单位跟着工作台走：照片侧「张」，漫画侧「页」。
  const { mode } = useAppMode();
  const unit = mode === "comic" ? "页" : "张";
  const isPhoto = mode === "photo";

  const entries = useMemo<TimelineEntry[]>(() => {
    if (timelineYears) {
      return timelineYears.map((year) => ({
        key: String(year.year),
        label: String(year.year),
        count: `${year.count} 张`,
        numeric: true,
        onActivate: () => navigate(`/photo?year=${year.year}`),
      }));
    }

    return groups.map((group) => {
      const filterValue = group.year ?? "other";
      const key = String(filterValue);
      // 选中态说的是「正筛着这一年」：没有漏斗的那一侧没有筛选，
      // 地址里残留的年份参数也不该点亮任何一张卡。
      const isActive = showFilter && yearFilter === filterValue;
      const triggerFilter = () => {
        toggleYear(filterValue);
        requestAnimationFrame(() =>
          gridRef?.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        );
      };
      // 年卡的主操作恒是「进入那一年」。年份多半对应一个同名集合
      // （首页上一年一个入口），没有集合时进文件最多的那一本。
      // 早先这里是两义的：一个节点时进入、多个节点时变成筛选器 ——
      // 同一张卡换个年份行为就不同，读起来像坏了。
      const enterTarget =
        group.albums.find((a) => a.variant === "collection") ?? group.albums[0];
      // 年卡上的计数说的是「这一年有多少照片」，不是「这一年有几个
      // 直属子项」：首页的年份多半对应一个同名集合，直属子项恒为 1，
      // 「1 本」对谁都没有信息量。
      // 只报照片数：再加一段视频数，184px 宽的卡里会折行成两行。
      const total = group.imageTotal ?? 0;
      const count =
        total > 0
          ? `${total} ${unit}`
          : `${group.count ?? group.albums.length} ${albumCountUnit(mode)}`;
      return {
        key,
        label: group.label,
        count,
        numeric: group.year !== null,
        coverPath: group.coverPreviewPaths.find(Boolean),
        coverVersion: group.coverPreviewVersions[0],
        active: isActive,
        onActivate: () => {
          // 照片侧：年份是一段照片的入口，不是文件夹的入口。
          // 直接看这一年的照片，用户不必先猜中是哪一本相册。
          if (isPhoto && group.year !== null) {
            navigate(yearRoute(String(group.year)));
            return;
          }
          if (enterTarget) navigate(enterTarget.to);
          else triggerFilter();
        },
        action: showFilter ? (
          <button
            type="button"
            onClick={triggerFilter}
            className="year-index__filter absolute top-2 right-2 grid place-items-center size-8 touch:size-10 [background:color-mix(in_srgb,var(--raised)_88%,transparent)] [backdrop-filter:blur(6px)] border border-line rounded-sm text-ink-2 transition duration-base opacity-0 [.year-index\_\_item:focus-within_&]:opacity-100 [.year-index\_\_item[data-active=true]_&]:opacity-100 [.year-index\_\_item:hover_&]:opacity-100 touch:opacity-100 hover:text-ink hover:bg-raised touch:active:text-ink touch:active:bg-raised"
            aria-label={isActive ? "取消年份筛选" : "筛选该年份"}
            title={isActive ? "取消筛选" : "只筛选该年份"}
          >
            <FilterIcon size={12} />
          </button>
        ) : undefined,
      };
    });
  }, [
    groups,
    timelineYears,
    yearFilter,
    toggleYear,
    navigate,
    gridRef,
    unit,
    mode,
    isPhoto,
    showFilter,
  ]);

  return <Timeline entries={entries} testId="year-timeline" />;
}
