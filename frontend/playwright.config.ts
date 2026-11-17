import { defineConfig, devices } from '@playwright/test'

// 触摸档：390×844 / DPR 3 / 有触摸 / 移动 UA。
//
// 不用 devices['Pixel 7']（412×839 / 2.625）—— 本仓窄屏的设计基准是 390，
// 换一套尺寸等于把基线也换了。
const PHONE = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['Pixel 7'].userAgent,
}

export default defineConfig({
  testDir: './tests/e2e',
  // 所有用例共享单进程临时服务及状态，跨文件也必须串行。
  workers: 1,
  outputDir: 'test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:18080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // 桌面档跑全部用例（窄屏用例在用例里自己缩视口）。
      name: 'chromium',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 触摸档只跑窄屏专项：整套用例跑三遍太慢，窄屏问题由这一个档盯着。
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { ...PHONE },
    },
    {
      // 横屏是另一套版式：阅读器按 100dvh 排、足迹页地图按 vh 压扁。
      name: 'mobile-landscape',
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...PHONE,
        viewport: { width: 844, height: 390 },
        screen: { width: 844, height: 390 },
      },
    },
  ],
})
