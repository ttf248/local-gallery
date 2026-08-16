import { useState } from 'react'
import { useUIStore } from '../../store/uiStore'
import { CopyIcon, CheckIcon } from './Icon'

interface Props {
  /** 复制到剪贴板的文本。 */
  value: string
  /** 触屏/鼠标 enter 时显示的提示文字。 */
  title?: string
}

// 复制按钮：点一下复制，1.5 秒内显示「已复制」勾，然后复位。
// 失败时 push 一条 error toast（与 ImageInfoPanel / PropertiesDialog
// 等所有「复制到剪贴板」交互保持一致反馈）。
//
// 内部用 navigator.clipboard.writeText；旧浏览器/不安全上下文回退到
// textarea + execCommand('copy')。两个分支都可能因为权限问题失败，
// 都用 pushToast 反馈。
export default function CopyButton({ value, title }: Props) {
  const [copied, setCopied] = useState(false)
  const pushToast = useUIStore((s) => s.pushToast)

  async function onClick() {
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        ok = true
      }
    } catch {
      // 落到下面 fallback
    }
    if (!ok) {
      // 兜底：textarea + execCommand（旧浏览器/不安全上下文）
      try {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        // 静默
      }
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      pushToast({ kind: 'error', message: '复制失败，请检查浏览器权限' })
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center w-4 h-4 rounded text-fg-subtle hover:text-fg hover:bg-bg-subtle transition-colors"
      title={copied ? '已复制' : title ?? '复制'}
      aria-label={copied ? '已复制' : title ?? '复制'}
    >
      {copied ? <CheckIcon size={10} /> : <CopyIcon size={10} />}
    </button>
  )
}
