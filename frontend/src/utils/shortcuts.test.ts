import { describe, expect, it } from 'vitest'
import { normalizeKey } from './shortcuts'

// 构造一个模拟 KeyboardEvent 对象的最小工具
function ev(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    key: '',
    ...overrides,
  } as KeyboardEvent
}

describe('normalizeKey', () => {
  it('单独字母小写', () => {
    expect(normalizeKey(ev({ key: 'A' }))).toBe('a')
    expect(normalizeKey(ev({ key: 'f' }))).toBe('f')
  })

  it('Ctrl + 字母保留 ctrl 前缀', () => {
    expect(normalizeKey(ev({ key: 's', ctrlKey: true }))).toBe('ctrl+s')
  })

  it('Cmd 等同 Ctrl（macOS）', () => {
    expect(normalizeKey(ev({ key: 's', metaKey: true }))).toBe('ctrl+s')
  })

  it('Shift + / 在 US 键盘产生 "?"，归一为字面 "?"，忽略 shift 前缀（双布局兼容）', () => {
    expect(normalizeKey(ev({ key: '?', shiftKey: true }))).toBe('?')
    // AZERTY 等布局不按 Shift 直接按 ? 键：也应归一为 '?'
    expect(normalizeKey(ev({ key: '?', shiftKey: false }))).toBe('?')
  })

  it('空格归一为 "space"', () => {
    expect(normalizeKey(ev({ key: ' ' }))).toBe('space')
  })

  it('修复：shift+= 在大多数键盘产生 e.key="+"，不应拼出 "shift+"', () => {
    // 旧实现：parts = ['shift', '+'] → 'shift+' → 命中不到 '+' handler
    // 新实现：'shift' 不参与符号键 → '+'
    expect(normalizeKey(ev({ key: '+', shiftKey: true }))).toBe('+')
  })

  it('修复：未按 shift 直接按 = 键也归一为 "+"', () => {
    expect(normalizeKey(ev({ key: '=', shiftKey: false }))).toBe('+')
  })

  it('Alt + 字母保留 alt 前缀', () => {
    expect(normalizeKey(ev({ key: 'a', altKey: true }))).toBe('alt+a')
  })

  it('Ctrl + Shift + 字母保留两个前缀', () => {
    expect(normalizeKey(ev({ key: 'A', ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+a')
  })

  it('特殊键名（ArrowLeft / Home）归一为小写', () => {
    expect(normalizeKey(ev({ key: 'ArrowLeft' }))).toBe('arrowleft')
    expect(normalizeKey(ev({ key: 'Home' }))).toBe('home')
  })

  it('shift + / 在大多数键盘产生 "?"，handler 表里用 "?"', () => {
    expect(normalizeKey(ev({ key: '?', shiftKey: true }))).toBe('?')
  })

  it('shift + 数字产生符号，保留 shift 前缀', () => {
    // shift+1 在 US 键盘产生 "!"
    expect(normalizeKey(ev({ key: '!', shiftKey: true }))).toBe('shift+!')
  })
})
