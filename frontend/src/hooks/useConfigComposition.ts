import { useEffect, useRef } from "react";

/**
 * 输入法组合输入的跟踪。
 *
 * 中文输入法拼到一半时按 Enter 是「选词」而不是「提交」，直接提交会存下
 * 一半的拼音。这里跟踪组合输入的起止，组合期间按 Enter 不提交，结束后
 * 再按 Enter 才提交。
 */
export function useConfigComposition(
  onChange: (value: string) => void,
  onCompositionChange: (active: boolean) => void,
) {
  const active = useRef(false);
  const notify = useRef(onCompositionChange);
  notify.current = onCompositionChange;
  const clear = () => {
    if (!active.current) return;
    active.current = false;
    notify.current(false);
  };
  useEffect(
    () => () => {
      if (active.current) {
        active.current = false;
        notify.current(false);
      }
    },
    [],
  );
  return {
    active,
    start: () => {
      if (active.current) return;
      active.current = true;
      notify.current(true);
    },
    finish: (value: string) => {
      if (!active.current) return;
      // 即使文字未变化也发布一次新草稿，从确认输入起重新计算保存间隔。
      onChange(value);
      clear();
    },
    clear,
  };
}
