// Playwright E2E 测试：启动浏览器，访问页面，截图各核心界面
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = 'http://127.0.0.1:8080'
const OUT = path.join(__dirname, '..', '.cache', 'e2e')

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

async function shot(page, name) {
  const f = path.join(OUT, name + '.png')
  await page.screenshot({ path: f, fullPage: true })
  console.log('  📸 ' + name + ' -> ' + f)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console.error]', m.text())
  })
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

  console.log('\n=== 1. 主页（本地图库） ===')
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await shot(page, '01-home')

  // 触发扫描
  const startBtn = await page.$('button:has-text("重新扫描"), button:has-text("开始扫描")')
  if (startBtn) {
    console.log('  → 触发扫描')
    await startBtn.click()
    // 等待完成（最多 20 秒）
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500)
      const txt = await page.textContent('body')
      if (!/扫描中|启动中/.test(txt)) break
    }
    await page.waitForTimeout(1500)
    await shot(page, '02-home-after-scan')
  }

  console.log('\n=== 2. 收藏页 ===')
  await page.goto(BASE + '/favorites', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await shot(page, '03-favorites')

  console.log('\n=== 3. 最近页 ===')
  await page.goto(BASE + '/recents', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await shot(page, '04-recents')

  console.log('\n=== 4. 设置页 ===')
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await shot(page, '05-settings')

  console.log('\n=== 5. 切换深色主题 ===')
  const themeBtn = await page.$('button[title*="主题"]')
  if (themeBtn) {
    await themeBtn.click()
    await page.waitForTimeout(300)
    await themeBtn.click()
    await page.waitForTimeout(300)
    await shot(page, '06-settings-dark')
    // 回到浅色
    await themeBtn.click()
    await page.waitForTimeout(300)
  }

  console.log('\n=== 6. 进入相册详情 ===')
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  // 找到第一个相册卡片并点击
  const card = await page.$('.grid > div')
  if (card) {
    await card.click()
    await page.waitForTimeout(1500)
    await shot(page, '07-album-detail')

    // 找到第一张图片点击进入画廊
    const img = await page.$('.grid > button')
    if (img) {
      await img.click()
      await page.waitForTimeout(1500)
      await shot(page, '08-gallery')

      // 触发信息面板
      await page.keyboard.press('i')
      await page.waitForTimeout(300)
      await shot(page, '09-gallery-info')

      // 触发帮助
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await page.keyboard.press('Control+/')
      await page.waitForTimeout(500)
      await shot(page, '10-gallery-help')

      // 关闭
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
    }
  }

  console.log('\n=== 7. 全局搜索 ===')
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const search = await page.$('input[placeholder^="搜索"]')
  if (search) {
    await search.click()
    await page.keyboard.type('夢', { delay: 100 })
    await page.waitForTimeout(500)
    await shot(page, '11-search-dropdown')

    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    await shot(page, '12-search-results')
  }

  console.log('\n=== 8. 视图切换（按作者筛选） ===')
  const tabs = await page.$$('button')
  for (const t of tabs) {
    const txt = await t.textContent()
    if (txt && /^作者/.test(txt.trim())) {
      await t.click()
      await page.waitForTimeout(500)
      await shot(page, '13-view-authors')
      break
    }
  }

  console.log('\n=== 9. 移动端响应式 ===')
  await page.setViewportSize({ width: 414, height: 800 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await shot(page, '14-mobile-home')
  await page.goto(BASE + '/recents', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await shot(page, '15-mobile-recents')

  console.log('\n=== 完成 ===')
  await browser.close()
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
