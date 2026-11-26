import { SelectionBar } from "./SelectionBar";
import type { PhotoSelectionEntry } from "../../store/photoSelectionStore";
import { DoublePageIcon, PickIcon, UncheckIcon } from "../../ui/icons";

interface Props {
  /** 当前选中的照片。 */
  selected: PhotoSelectionEntry[];
  /** 其中已经在精选里的张数。 */
  pickedCount: number;
  /** 把选中的照片加入精选。 */
  onAddPicks: () => void;
  /** 把选中的照片移出精选。 */
  onRemovePicks: () => void;
  /** 并排对比选中的两张。 */
  onCompare: () => void;
  /** 退出多选。 */
  onExit: () => void;
  busy?: boolean;
}

/**
 * 照片墙的多选操作条。
 *
 * 它浮在墙的下缘而不是把内容往下推：照片墙是浏览页，往下顶一截
 * 就等于把刚看到的照片挤走半屏 —— 那一屏正是用户挑东西的地方。
 *
 * 条上只放这一轮真正要做的动作：加精选、去精选、并排对比、退出。
 * 「选择已加载项」这类批量动作放在相册列表那边，照片墙不重复。
 */
export default function PhotoSelectionActions({
  selected,
  pickedCount,
  onAddPicks,
  onRemovePicks,
  onCompare,
  onExit,
  busy = false,
}: Props) {
  const count = selected.length;
  const allPicked = count > 0 && pickedCount === count;
  const nonePicked = pickedCount === 0;
  // 并排对比只看图片：视频没有可并排的画面，放进来只能给一块封面。
  const comparable =
    count === 2 && selected.every((item) => item.kind !== "video");
  // 两个动作按实际情况露出来：已经全在精选里时不必要求「加入精选」，
  // 一张都不在时也不必要求「移出精选」。
  const showAdd = !allPicked;
  const showRemove = !nonePicked;

  return (
    <SelectionBar
      active
      count={count}
      noun="张"
      busy={busy}
      label="照片多选操作"
      detail={pickedCount ? pickedCount + " 张在精选" : undefined}
      onExit={onExit}
      actions={[
        ...(showAdd
          ? [
              {
                id: "add",
                label: "加入精选",
                description: "把选中的照片加入精选",
                icon: <PickIcon size={15} />,
                disabled: !count,
                onRun: onAddPicks,
              },
            ]
          : []),
        ...(showRemove
          ? [
              {
                id: "remove",
                label: "移出精选",
                description: "把选中的照片移出精选",
                icon: <UncheckIcon size={15} />,
                disabled: !count,
                onRun: onRemovePicks,
              },
            ]
          : []),
        {
          id: "compare",
          label: "并排对比",
          description: "并排对比选中的两张",
          disabled: !comparable,
          onRun: onCompare,
          icon: <DoublePageIcon size={15} />,
        },
      ]}
    />
  );
}
