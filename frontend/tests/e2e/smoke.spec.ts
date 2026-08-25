import { expect, test } from '@playwright/test'

test('扫描并打开示例相册', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Local Gallery', { exact: false }).first()).toBeVisible()

  const scanButton = page.getByRole('button', { name: /开始扫描|重新扫描/ }).first()
  if (await scanButton.isVisible()) {
    await scanButton.click()
  }

  await expect(page.getByText('sample-album', { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  })
})

test('设置页可加载服务端配置', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByText('服务端', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('图像根目录', { exact: false }).first()).toBeVisible()
})
