import { StateCreator } from 'zustand'

// sessionStorage 持久化中间件（与 zustand/middleware 的 persist 类似，但用 sessionStorage）。
export function sessionStorage<T extends object>(
  initializer: StateCreator<T, [], []>,
  name: string,
): StateCreator<T, [], []> {
  return (set, get, api) => {
    const stored = readSession<T>(name)
    const initial = stored ?? initializer(set, get, api)

    api.setState = (updater) => {
      set(updater)
      writeSession(name, get())
    }

    if (stored) {
      // 用已存的 state 替换默认初始值
      Object.assign(api.getState(), stored)
    }

    return initial
  }
}

function readSession<T>(name: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(name)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeSession<T>(name: string, value: T) {
  try {
    window.sessionStorage.setItem(name, JSON.stringify(value))
  } catch {
    /* quota */
  }
}
