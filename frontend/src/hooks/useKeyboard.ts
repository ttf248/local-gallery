import { useEffect, useRef } from 'react'
import { normalizeKey } from '../utils/shortcuts'

// useKeyboard 注册全局键盘快捷键。
// handlers: { [combo: string]: handler }
// 输入框 / 可编辑元素中的按键默认被忽略（避免与文字输入冲突）。
export function useKeyboard(
  handlers: Record<string, (e: KeyboardEvent) => void>,
  enabled = true,
) {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!enabled) return
    const fn = (e: KeyboardEvent) => {
      // 跳过输入框
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return
        }
      }
      const combo = normalizeKey(e)
      const h = ref.current[combo]
      if (h) {
        e.preventDefault()
        h(e)
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [enabled])
}
