import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServerConfigPanel from './ServerConfigPanel'
import { configApi } from '../../api/config'
import { useUIStore } from '../../store/uiStore'

// Mock the config API
vi.mock('../../api/config', () => ({
  configApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
}))

// Mock the library store (loadFromBackend)
vi.mock('../../store/libraryStore', () => ({
  useLibraryStore: () => ({
    loadFromBackend: vi.fn().mockResolvedValue(undefined),
  }),
}))

const baseConfig = {
  mediaRoot: 'E:\\漫画',
  host: '0.0.0.0',
  port: 8080,
  cacheDir: '.image-viewer',
  thumbSizeW: 320,
  thumbSizeH: 350,
  thumbCacheSize: 500,
  cacheMaxAgeDays: 30,
  allowOsOpen: false,
  staticDir: 'dist',
  configPath: 'C:\\cfg.yaml',
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ServerConfigPanel />
    </QueryClientProvider>,
  )
}

describe('ServerConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(configApi.get).mockResolvedValue(baseConfig)
    vi.mocked(configApi.update).mockResolvedValue({
      ok: true,
      config: { ...baseConfig, allowOsOpen: true },
      requiresRestart: [],
      mediaRootChanged: false,
    })
    // 重置 toasts
    useUIStore.setState({ toasts: [] })
  })

  it('渲染当前配置', async () => {
    renderPanel()
    expect(await screen.findByDisplayValue('E:\\漫画')).toBeInTheDocument()
    expect(screen.getByDisplayValue('.image-viewer')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0.0.0.0')).toBeInTheDocument()
    expect(screen.getByDisplayValue('8080')).toBeInTheDocument()
  })

  it('切换 boolean 立即保存', async () => {
    renderPanel()
    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(configApi.update).toHaveBeenCalledWith({ allowOsOpen: true })
    })
  })

  it('修改数字后 debounce 触发保存', async () => {
    renderPanel()
    const portInput = (await screen.findByDisplayValue('8080')) as HTMLInputElement
    fireEvent.change(portInput, { target: { value: '9090' } })
    // debounce 期间不应立即调用
    expect(configApi.update).not.toHaveBeenCalled()
    // 等待 debounce + flush（默认 600ms + 余量）
    await waitFor(
      () => expect(configApi.update).toHaveBeenCalledWith({ port: 9090 }),
      { timeout: 1500 },
    )
  })

  it('修改 port 后弹出"需重启"提示', async () => {
    vi.mocked(configApi.update).mockResolvedValue({
      ok: true,
      config: { ...baseConfig, port: 9090 },
      requiresRestart: ['port'],
      mediaRootChanged: false,
    })
    renderPanel()
    const portInput = (await screen.findByDisplayValue('8080')) as HTMLInputElement
    fireEvent.change(portInput, { target: { value: '9090' } })
    await waitFor(
      () => expect(configApi.update).toHaveBeenCalledWith({ port: 9090 }),
      { timeout: 1500 },
    )
    // toast 文本进入 store（ToastViewport 在路由层挂载，单测里查 DOM 不可靠）
    await waitFor(() => {
      const toasts = useUIStore.getState().toasts
      expect(toasts.some((t) => t.message.includes('修改后需要重启后端才能生效'))).toBe(true)
    })
  })

  it('mediaRoot 变更后提示重新扫描', async () => {
    vi.mocked(configApi.update).mockResolvedValue({
      ok: true,
      config: { ...baseConfig, mediaRoot: 'D:\\new' },
      requiresRestart: [],
      mediaRootChanged: true,
    })
    renderPanel()
    const input = (await screen.findByDisplayValue('E:\\漫画')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'D:\\new' } })
    await waitFor(
      () => expect(configApi.update).toHaveBeenCalledWith({ mediaRoot: 'D:\\new' }),
      { timeout: 1500 },
    )
    expect(await screen.findByText(/图像根目录已变更/)).toBeInTheDocument()
  })

  it('保存失败时显示错误 toast', async () => {
    vi.mocked(configApi.update).mockRejectedValueOnce(new Error('invalid port'))
    renderPanel()
    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)
    await waitFor(() => {
      const toasts = useUIStore.getState().toasts
      expect(toasts.some((t) => t.message.includes('invalid port'))).toBe(true)
    })
  })
})
