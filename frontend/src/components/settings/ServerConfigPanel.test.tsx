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
  mediaRoots: ['E:\\漫画'],
  mediaRoot: 'E:\\漫画',
  host: '0.0.0.0',
  port: 8080,
  cacheDir: '.local-gallery',
  thumbSizeW: 320,
  thumbSizeH: 350,
  thumbCacheSize: 500,
  cacheMaxAgeDays: 30,
  allowOsOpen: false,
  staticDir: 'dist',
  configPath: 'C:\\cfg.yaml',
  // 排除规则三件套:与后端 Config 字段一一对应
  skipHidden: true,
  systemFiles: [],
  excludePatterns: [],
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
      mediaRootsChanged: false,
    })
    // 重置 toasts
    useUIStore.setState({ toasts: [] })
  })

  it('渲染当前配置', async () => {
    renderPanel()
    // mediaRoots 数组作为多 input 列表渲染
    expect(await screen.findByDisplayValue('E:\\漫画')).toBeInTheDocument()
    expect(screen.getByDisplayValue('.local-gallery')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0.0.0.0')).toBeInTheDocument()
    expect(screen.getByDisplayValue('8080')).toBeInTheDocument()
  })

  it('切换 boolean 立即保存', async () => {
    renderPanel()
    // 现在有多个 switch（allowOsOpen + skipHidden）;用 label 文本锁定目标
    const toggle = await screen.findByRole('switch', { name: /允许在系统文件管理器中打开/ })
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
      mediaRootsChanged: false,
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

  it('mediaRoots 变更后提示重新扫描', async () => {
    vi.mocked(configApi.update).mockResolvedValue({
      ok: true,
      config: { ...baseConfig, mediaRoots: ['D:\\new'], mediaRoot: 'D:\\new' },
      requiresRestart: [],
      mediaRootsChanged: true,
    })
    renderPanel()
    const input = (await screen.findByDisplayValue('E:\\漫画')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'D:\\new' } })
    // 路径类字段在 blur 时保存
    fireEvent.blur(input)
    await waitFor(
      () => expect(configApi.update).toHaveBeenCalledWith({ mediaRoots: ['D:\\new'] }),
      { timeout: 1500 },
    )
    expect(await screen.findByText(/媒体根目录已变更/)).toBeInTheDocument()
  })

  it('多根：添加 / 删除根目录会更新 local state（blur 后 flush）', async () => {
    vi.mocked(configApi.update).mockResolvedValue({
      ok: true,
      config: { ...baseConfig, mediaRoots: ['E:\\漫画', 'F:\\照片'] },
      requiresRestart: [],
      mediaRootsChanged: true,
    })
    renderPanel()
    // 等待首个 input 出现
    const firstInput = (await screen.findByDisplayValue('E:\\漫画')) as HTMLInputElement
    // 找「添加根目录」按钮并点击
    const addBtn = await screen.findByText(/添加根目录/)
    fireEvent.click(addBtn)
    // 等 React 渲染：新行 input 应该是空值
    const allInputs = await screen.findAllByRole('textbox')
    // 过滤出媒体根 input（placeholder 包含「照片」或「/home/user/pics」）
    const mediaRootInputs = allInputs.filter(
      (el) => (el as HTMLInputElement).placeholder.includes('照片') || (el as HTMLInputElement).placeholder.includes('/home/user/pics'),
    )
    expect(mediaRootInputs.length).toBeGreaterThanOrEqual(2)
    // 修改第二个为空槽位 → F:\\照片
    const secondInput = mediaRootInputs[1] as HTMLInputElement
    fireEvent.change(secondInput, { target: { value: 'F:\\照片' } })
    // blur 第一个 input 触发保存（媒体根字段共用 pathDirtyRef 一次 flush）
    fireEvent.blur(firstInput)
    await waitFor(
      () =>
        expect(configApi.update).toHaveBeenCalledWith({
          mediaRoots: ['E:\\漫画', 'F:\\照片'],
        }),
      { timeout: 1500 },
    )
    expect(firstInput).toBeInTheDocument()
  })

  it('保存失败时显示错误 toast', async () => {
    vi.mocked(configApi.update).mockRejectedValueOnce(new Error('invalid port'))
    renderPanel()
    const toggle = await screen.findByRole('switch', { name: /允许在系统文件管理器中打开/ })
    fireEvent.click(toggle)
    await waitFor(() => {
      const toasts = useUIStore.getState().toasts
      expect(toasts.some((t) => t.message.includes('invalid port'))).toBe(true)
    })
  })

  it('排除模式：编辑+blur 触发 PATCH,空行 trim 掉', async () => {
    renderPanel()
    // 找到「排除模式」textarea。给它一段内容,验证:onBlur 后空行被丢、
    // 单条非空 pattern 走 PATCH。
    const textarea = (await screen.findByPlaceholderText(/node_modules/)) as HTMLTextAreaElement
    fireEvent.change(textarea, {
      target: { value: 'node_modules\n\n  \nbackup_*' },
    })
    fireEvent.blur(textarea)
    await waitFor(() => {
      expect(configApi.update).toHaveBeenCalledWith({
        excludePatterns: ['node_modules', 'backup_*'],
      })
    })
  })

  it('skipHidden toggle 切换立即 PATCH', async () => {
    renderPanel()
    const toggle = await screen.findByRole('switch', { name: '跳过隐藏目录' })
    // 默认 baseConfig.skipHidden=true;点一下应变为 false
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(configApi.update).toHaveBeenCalledWith({ skipHidden: false })
    })
  })
})
