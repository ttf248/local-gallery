import { useEffect, useState } from 'react'

export default function StatusBar() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <footer className="h-6 px-3 flex items-center justify-between text-xs text-fg-subtle border-t border-border bg-bg-elevated">
      <span>就绪</span>
      <span>{now.toLocaleTimeString()}</span>
    </footer>
  )
}
