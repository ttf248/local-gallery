import { useCallback } from "react";
import { usePicks } from "./usePicks";
import { useUIStore } from "../store/uiStore";

/**
 * 照片墙上的精选开关。
 *
 * 精选是照片级的事：加入 / 移出精选在每一面照片墙上都是同一个动作，
 * 失败时该说的那句话也是同一句。墙角的角标与大图预览里的那个勾用的是
 * 同一个函数，两处不会走岔。
 */
export function usePickToggle() {
  const picks = usePicks();
  const pushToast = useUIStore((s) => s.pushToast);
  const { toggle: rawToggle } = picks;

  /** 切换一张照片的精选状态；失败时把原因说出来。 */
  const toggle = useCallback(
    (id: string) => {
      void rawToggle(id).catch(() =>
        pushToast({ kind: "error", message: "精选操作失败" }),
      );
    },
    [rawToggle, pushToast],
  );

  return { ...picks, toggle };
}
