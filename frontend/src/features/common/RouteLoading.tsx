export default function RouteLoading() {
  return (
    <div
      className="min-h-full flex items-center justify-center gap-3 text-body text-ink-2"
      role="status"
      aria-live="polite"
    >
      <span className="w-5 h-5 rounded-full border-2 border-ink-3 border-t-primary animate-spin" />
      正在加载页面…
    </div>
  )
}
