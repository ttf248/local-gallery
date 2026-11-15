import { useEffect, useState } from "react";

/**
 * 自动保存用的快照。
 *
 * 只在当前输入完整等待过间隔之后才把值交出去：用户敲字的过程中不会
 * 触发保存，等他停下来才提交。暂停（正在组合输入、正在读配置）会让旧
 * 结果作废，恢复后重新计时 —— 否则会保存下一段还没写完的话。
 */
export function useAutosaveSnapshot<T>(
  value: T,
  delay: number,
  paused = false,
): T | undefined {
  const [snapshot, setSnapshot] = useState<{ value: T } | null>(null);
  useEffect(() => {
    if (paused) {
      setSnapshot(null);
      return;
    }
    const timer = setTimeout(() => setSnapshot({ value }), delay);
    return () => clearTimeout(timer);
  }, [value, delay, paused]);
  return !paused && snapshot !== null && snapshot.value === value
    ? snapshot.value
    : undefined;
}
