// 布局与排版审计：量化内容宽度、字号、溢出等技术指标，不评价设计是否好看。
// 按页面变体验证正文宽度，并独立测量顶栏、侧栏与底栏。
//
// 用法：
//   npm run audit:layout                                   # 默认页面 / 断点 / 明暗
//   LG_BASE=http://127.0.0.1:5173 npm run audit:layout
//   LG_PAGES=/,/unread npm run audit:layout
//   LG_VIEWPORTS=390x844,1440x900 npm run audit:layout
//   LG_THEMES=dark npm run audit:layout
//   LG_VIEWMODE=list npm run audit:layout                  # 审计列表视图
//   LG_TOUCH=1 npm run audit:layout                      # 触摸仿真档（手机）
//   LG_DPR=3 npm run audit:layout                        # 设备像素比
//   LG_ORIENTATION=both npm run audit:layout             # 横屏也量一遍
//   npm run audit:layout -- --json                          # 输出机器可读 JSON
//
// 输出的核心指标：
//   - contentWidthRatio : 主内容实际占视口宽度的比例（结合版式判断空间使用）
//   - gutterRatio       : 左右空白各占视口宽度的比例
//   - effectiveLeft/Right : 内容实际左右缘（页面留白是否两边一致）
//   - shellLeft/Right   : 内容容器自身的左右边界（各页是否用同一个容器）
//   - tinyText[]        : 实际渲染字号 < 12px 的可见文本（中文可读性下限）
//   - controlHeights    : 可交互控件的实际高度分布（触控目标是否达标）
//   - touchTargets[]    : 触摸档下有效命中区不足 40×40 的控件
//   - overflowPx        : 横向溢出像素
//
// 退出码：横向溢出、外壳尺寸、容器变体或页面加载失败时为 1。
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import {
  buildRoute,
  resolveAlbumId,
  openPhotoViewer,
  resolveMode,
} from "./lib/workbench-routes.mjs";
import {
  profileOptionsFromEnv,
  resolveProfiles,
} from "./lib/device-profile.mjs";

const BASE = process.env.LG_BASE ?? "http://127.0.0.1:5173";
const THEMES = (process.env.LG_THEMES ?? "light,dark")
  .split(",")
  .filter(Boolean);
// 页面清单里可以写伪路由：
//   album  —— 相册详情页（id 每次运行不同，从仪表盘现取一本图多的相册）
//   reader —— 阅读器（沉浸场景：顶栏 + 画面 + 浮动工具条 + 底部翻页条）
//   tag    —— 标签页（真实库里可能一个标签都没有，用仪表盘里的真实相册
//             伪造标签页数据，封面仍是真实缩略图）
const PAGES = (
  process.env.LG_PAGES ??
  "/,/library,/explore,/comic,/comic/library,/comic/unread,/comic/me/reading,/search,/me/picks,/me/favorites,/me/recents,/unread,/settings/general,/settings/tasks,/settings/storage,/settings/server,/travels,/smart-albums,/photo/random,/photo/semantic,/photo/people,/photo/people/annotate,/photo/similarity,album,viewer,reader,tag"
)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
// 视图模式：grid（默认）/ list。列表视图是另一套排版（行式），
// 字号与控件尺寸都要单独量一遍，不能拿网格视图的数据代替。
const VIEWMODE = process.env.LG_VIEWMODE ?? "grid";
const VIEWPORTS = (
  process.env.LG_VIEWPORTS ??
  "390x844,768x1024,1024x768,1440x900,1920x1080,2560x1440"
)
  .split(",")
  .map((v) => {
    const [w, h] = v.split("x").map(Number);
    return { width: w, height: h };
  })
  .filter((v) => Number.isFinite(v.width));
// 设备档位：视口 + 触摸 + 像素比 + 横竖屏（见 lib/device-profile.mjs）。
const PROFILES = resolveProfiles({
  viewports: VIEWPORTS,
  ...profileOptionsFromEnv(),
});

const MIN_FONT_PX = 12;
const MIN_CONTROL_PX = 32;
const MIN_TOUCH_TARGET_PX = 40;

const MEASURE = ({ minFontPx, minControlPx, touch, minTouchTargetPx }) => {
  // 祖先链上只要有一层是透明的，这个元素就等于没显示。
  //
  // 只看元素自己的 opacity 会漏掉「悬停才显形」的那一层：照片墙的
  // 瓦片信息层（文件名 + 像素尺寸）整层 opacity-0，里面的文字却是 1。
  // 审计把它当成真实内容，算出瓦片左缘 + 10px 的「内容左缘」，
  // 报出并不存在的不对齐。
  const effectivelyHidden = (el) => {
    let cur = el;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      if (Number(cs.opacity) < 0.05) return true;
      if (cs.visibility === "hidden" || cs.display === "none") return true;
      // 收起的 <details> 只露出 summary，里面的内容用户看不到，
      // 不该被算成"页面上的可见控件"。子元素仍会量到自己的尺寸，
      // 只靠 display:none 判断不到这一层。没有 summary 的 details
      // 内容始终可见，不按收起处理。
      if (cur instanceof HTMLDetailsElement && !cur.open) {
        const summary = cur.querySelector(":scope > summary");
        if (summary && !summary.contains(el)) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };
  const visible = (el) => {
    const modal = document.querySelector("dialog:modal");
    if (modal && !modal.contains(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) < 0.05) return false;
    if (effectivelyHidden(el)) return false;
    return true;
  };

  const main = document.querySelector("main");
  const mainRect = main?.getBoundingClientRect() ?? null;

  // 页面是否掉进了错误边界（React 渲染期异常）。
  // 掉进去的页面没有内容可量：把它当成"内容左缘不对齐"是误导，
  // 必须单独报出来（相册详情页偶发爆栈就是这一类）。
  const routeError = !!document.querySelector('[role="alert"]');

  // 主内容容器：正文里的第一个 [data-page]，再退回 <main> 与 body。
  // 取第一个有实际宽度的 —— 页面级的容器有些是 display: contents，
  // 没有盒子。
  const shellCandidates = [
    main?.querySelector("[data-page]"),
    main?.querySelector("[data-page]"),
    main,
    document.body,
  ];
  const shell =
    shellCandidates.find(
      (element) => element && element.getBoundingClientRect().width > 0,
    ) ?? document.body;
  const shellRect = shell.getBoundingClientRect();

  // 文本节点字体统计：只看直接包含文字的元素，避免把父容器算进去。
  const fontSizeCounts = new Map();
  const tinyText = [];
  const textElements = document.querySelectorAll("body *");
  for (const el of textElements) {
    if (!visible(el)) continue;
    const hasOwnText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (!hasOwnText) continue;
    const style = getComputedStyle(el);
    const size = Math.round(parseFloat(style.fontSize) * 100) / 100;
    fontSizeCounts.set(size, (fontSizeCounts.get(size) ?? 0) + 1);
    if (size < minFontPx) {
      tinyText.push({
        size,
        text: (el.textContent ?? "").trim().slice(0, 40),
        cls: (el.getAttribute("class") || "").slice(0, 80),
      });
    }
  }

  // 交互控件实际高度
  const controlHeights = [];
  const controls = document.querySelectorAll(
    "button, a[href], input, select, textarea, [role='button'], [role='tab']",
  );
  // 行内链接不算控件：它的盒子就是文字所在的那一行的行盒，撑到 32px
  // （或触摸档的 40px）会把段落撑散。独立成行的链接（卡片标题、
  // 「回到相册」）在 flex/grid 里会被块化，computed display 不是
  // inline，仍受两条门禁约束 —— 这正是要区别对待的那一类。
  const isInlineLink = (el) =>
    el.tagName.toLowerCase() === "a" &&
    getComputedStyle(el).display === "inline";
  // 太小的控件：只算真正点得到的。屏幕阅读器专用的元素（sr-only）
  // 不是控件；勾选框与单选钮本体只有十几像素，点的是它外面的
  // label —— 与触摸档的命中区判定同一口径。
  const smallControlList = [];
  for (const el of controls) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    const text = (el.getAttribute("aria-label") || el.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 30);
    if (rect.height < minControlPx || rect.width < minControlPx) {
      const cls = String(el.className || "");
      const tag = el.tagName.toLowerCase();
      const isHiddenForScreenReader = cls.includes("sr-only");
      const isCheckable =
        tag === "input" &&
        ["checkbox", "radio"].includes(el.getAttribute("type") ?? "");
      if (!isHiddenForScreenReader && !isCheckable && !isInlineLink(el)) {
        smallControlList.push({
          w: Math.round(rect.width * 10) / 10,
          h: Math.round(rect.height * 10) / 10,
          text,
          cls: cls.slice(0, 60),
          tag,
        });
      }
    }
    controlHeights.push({ h: Math.round(rect.height * 10) / 10, text });
  }

  // 有效命中区（只在触摸档量）：手指点的是控件周围约 40×40 的一块，
  // 不是按钮本身那几像素。
  //
  // 用 elementFromPoint 打四角与中心：伪元素扩区能过；相邻控件抢走命中、
  // 浮层压住按钮这类「看得见却点不到」的情况能被抓出来。只量视口内的
  // 控件 —— 视口外的点 elementFromPoint 返回空，算不上失败。
  const touchTargets = [];
  if (touch) {
    for (const el of controls) {
      if (!visible(el)) continue;
      // 屏幕阅读器专用的元素（sr-only）不是可点的控件：它被裁到
      // 一像素，点不到也不该算命中区不足。
      if (String(el.className || "").includes("sr-only")) continue;
      // 行内链接同上面那条理由：命中区就是那行字，不能撑。
      if (isInlineLink(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.bottom < 0 || rect.right < 0) continue;
      if (rect.top > window.innerHeight || rect.left > window.innerWidth) {
        continue;
      }
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const reach = minTouchTargetPx / 2;
      const points = [
        [-reach, -reach],
        [reach, -reach],
        [-reach, reach],
        [reach, reach],
        [0, 0],
      ];
      // 本体就够大的控件不用查：它的 40×40 中心区必然落在自己身上，
      // 被邻居压住角也不影响点得到（照片墙的行会挨着）。
      if (rect.width >= minTouchTargetPx && rect.height >= minTouchTargetPx) {
        continue;
      }
      // 复选框与单选钮本身只有十几像素见方，但它们包在 label 里 ——
      // 手指点的是 label（点文字也行）。label 够大就算达标。
      const label = el.matches('input[type="checkbox"], input[type="radio"]')
        ? el.closest("label")
        : null;
      let reachable;
      if (label) {
        const lRect = label.getBoundingClientRect();
        reachable =
          lRect.width >= minTouchTargetPx && lRect.height >= minTouchTargetPx;
      } else {
        reachable = points.every(([dx, dy]) => {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          return hit === el || (hit !== null && el.contains(hit));
        });
      }
      if (!reachable) {
        touchTargets.push({
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (el.getAttribute("aria-label") || el.textContent || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 30),
        });
      }
    }
  }

  // 有效内容范围：main 里可见的"叶子内容"（文字 / 图片 / 控件）的并集。
  //
  // 容器宽度 ≠ 内容宽度。设置页的容器铺满整个主区，实际内容却只有
  // 768px 一列 —— 只看容器宽度，这一页会被记成"和其他页一样宽"，
  // 它的居中窄列（1440 下比其它页右移 237px）就永远不会被发现。
  //
  // 当前跨页对齐基线使用左缘测量；不同页面布局可另行设定适用范围。
  const inkLeft = { v: Infinity };
  const inkRight = { v: -Infinity };
  const inkWidth = { v: 0 };
  const inkLeaves = [];
  // 横向滚动容器里的内容（首页的横向货架）会被容器裁掉，
  // 不能按它的原始位置算内容范围 —— 否则首页在 390px 下会被算成
  // "内容宽 958px"。
  const clippedRect = (el) => {
    const rect = el.getBoundingClientRect();
    let out = rect;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      if (/(auto|scroll|hidden)/.test(cs.overflowX)) {
        const cr = cur.getBoundingClientRect();
        const left = Math.max(out.left, cr.left);
        const right = Math.min(out.right, cr.right);
        if (right - left < 1) return null;
        out = new DOMRect(left, out.top, right - left, out.height);
      }
      cur = cur.parentElement;
    }
    return out;
  };
  const consider = (el) => {
    if (!visible(el)) return;
    const rect = clippedRect(el);
    if (!rect || rect.width < 1 || rect.height < 1) return;
    inkLeft.v = Math.min(inkLeft.v, rect.left);
    inkRight.v = Math.max(inkRight.v, rect.right);
    inkLeaves.push(rect);
  };
  if (main) {
    const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      if (!node.textContent.trim()) continue;
      if (node.parentElement) consider(node.parentElement);
    }
    // 图片里 alt 为空的是装饰图（相册页的模糊底图、标签页的头图底衬），
    // 它们本来就故意铺满并溢出容器，不能算进"内容范围"。
    for (const el of main.querySelectorAll("img")) {
      if (el.getAttribute("alt") === "") continue;
      consider(el);
    }
  }
  const effectiveLeft = Number.isFinite(inkLeft.v)
    ? Math.round(inkLeft.v)
    : null;
  const effectiveRight = Number.isFinite(inkRight.v)
    ? Math.round(inkRight.v)
    : null;
  const effectiveWidth =
    effectiveLeft !== null && effectiveRight !== null
      ? effectiveRight - effectiveLeft
      : null;

  const doc = document.documentElement;
  const overflowPx = Math.max(
    0,
    doc.scrollWidth - doc.clientWidth,
    document.body.scrollWidth - doc.clientWidth,
    (main?.scrollWidth ?? 0) - (main?.clientWidth ?? 0),
  );

  const viewportWidth = window.innerWidth;
  const contentWidth = Math.round(shellRect.width);
  const gutter = Math.max(0, Math.round((viewportWidth - contentWidth) / 2));

  const rail = document.querySelector('[data-testid="nav-rail"]');
  const top = document.querySelector('[data-testid="top-bar"]');
  const bottom = document.querySelector('nav.mobile-tabs[aria-label="主导航"]');
  const immersive = Boolean(
    document.querySelector('.reader-shell, [data-testid="photo-viewer"]'),
  );
  const chromeIssues = [];
  const desktop = viewportWidth >= 1024;
  const hasBottom = Boolean(
    bottom &&
    !effectivelyHidden(bottom) &&
    bottom.getBoundingClientRect().height > 0,
  );
  if (main && !immersive) {
    if (desktop) {
      const canvas = document.querySelector("[data-canvas]");
      const rect=canvas?.getBoundingClientRect();
      if (!rect || Math.abs(rect.top-8)>1 || Math.abs(rect.bottom-window.innerHeight+8)>1 || Math.abs(rect.right-viewportWidth+8)>1 || Math.abs(rect.left-(rail?.getBoundingClientRect().right ?? 0))>1 || getComputedStyle(canvas).borderTopLeftRadius!=="16px") chromeIssues.push("画布内缩或圆角不符");
      const expected = rail?.dataset.collapsed === "true" ? 72 : 240;
      const width = rail?.getBoundingClientRect().width ?? 0;
      if (Math.abs(width - expected) > 1)
        chromeIssues.push("侧栏宽度 " + width + "，预期 " + expected);
    }
    const bounds = top?.getBoundingClientRect();
    if (
      !bounds ||
      bounds.height !== (desktop ? 56 : 52) ||
      Math.abs(bounds.top - (desktop ? 8 : 0)) > 1 ||
      getComputedStyle(top).position !== "sticky"
    )
      chromeIssues.push("顶栏高度或贴顶位置异常");
    if (
      !desktop &&
      (!hasBottom ||
        bottom.getBoundingClientRect().height < 64 ||
        Math.abs(bottom.getBoundingClientRect().bottom - window.innerHeight) >
          1)
    )
      chromeIssues.push("窄屏主导航未贴底或高度不足 64px");
  }
  if ((desktop || immersive) && hasBottom)
    chromeIssues.push("当前视图不应显示底栏");
  const variant = shell.dataset.page ?? "standard";
  const expectedMax = {
    standard: 1440,
    system: 1440,
    gallery: "none",
    focused: 760,
    workspace: "none",
  }[variant];
  const max = getComputedStyle(shell).maxWidth;
  const actualMax = max === "none" ? max : parseFloat(max);
  if (main && !immersive && actualMax !== expectedMax)
    chromeIssues.push(
      "页面容器 " + variant + " 上限 " + actualMax + "，预期 " + expectedMax,
    );
  if (main?.querySelector(".library-page #library-tree"))
    chromeIssues.push("目录抽屉默认应收起");

  return {
    chromeIssues,
    viewport: { width: viewportWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio,
    zoom: Math.round((window.outerWidth / window.innerWidth || 1) * 100),
    contentWidth,
    contentWidthRatio: Math.round((contentWidth / viewportWidth) * 1000) / 1000,
    gutter,
    gutterRatio: Math.round((gutter / viewportWidth) * 1000) / 1000,
    // 容器自身的左右边界：所有页面应当是同一个容器，因此同一断点下
    // 这两个值必须逐页相等 —— 这是「左右留白一致」最直接的证据。
    shellLeft: Math.round(shellRect.left),
    shellRight: Math.round(shellRect.right),
    routeError,
    effectiveWidth,
    effectiveLeft,
    effectiveRight,
    // 右侧留白：视口右缘到内容右缘。左右留白不等时，页面右侧会空出
    // 一块与左侧不同的空白 —— 27 寸上最显眼。
    rightGap:
      effectiveRight === null
        ? null
        : Math.round(viewportWidth - effectiveRight),
    variant,
    actualMax,
    effectiveRatio:
      effectiveWidth === null
        ? null
        : Math.round((effectiveWidth / viewportWidth) * 1000) / 1000,
    mainWidth: mainRect ? Math.round(mainRect.width) : null,
    overflowPx,
    fontSizeCounts: [...fontSizeCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([size, count]) => ({ size, count })),
    tinyText: tinyText.slice(0, 20),
    tinyTextTotal: tinyText.length,
    controlHeightCounts: Object.entries(
      controlHeights.reduce((acc, c) => {
        const key = String(c.h);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([h, count]) => ({ h: Number(h), count }))
      .sort((a, b) => a.h - b.h),
    smallControls: smallControlList.slice(0, 10),
    smallControlsTotal: smallControlList.length,
    // 触摸档才有：有效命中区不足的控件。
    touchTargets: touchTargets.slice(0, 20),
    touchTargetsTotal: touchTargets.length,
  };
};

/**
 * 触摸档的外壳可达性：抽屉开合与软键盘遮挡。
 *
 * 这两件事只在触摸设备上出现，桌面档量不到：
 * 抽屉是模态浮层 —— 背景必须不可聚焦、内容不可滚、焦点不能跑出去；
 * 软键盘弹起时可视视口变矮，贴底的输入框会被顶到看不见的地方。
 *
 * 这里的两项都是门禁：抽屉的模态语义不完整、软键盘遮住输入框，
 * 都会让审计以 1 退出。命中区那一项在页面上量（见 MEASURE）。
 */
async function checkMobileShell(page) {
  const trigger = page.getByRole("button", { name: "更多", exact: true });
  if ((await trigger.count()) === 0 || !(await trigger.isVisible())) {
    // 抽屉只存在于窄屏：宽屏上侧栏常驻，没有「打开导航」这一档。
    return {
      drawer: { skipped: "这一档没有抽屉（侧栏常驻）" },
      keyboard: { skipped: "这一档没有抽屉（侧栏常驻）" },
    };
  }
  await trigger.click();
  await page.waitForTimeout(350);
  const drawerState = await page.evaluate(() => {
    const nav = document.querySelector('dialog[aria-label="更多"]');
    const main = document.querySelector(".app-main");
    const active = document.activeElement;
    return {
      opened: Boolean(nav),
      focusInside: Boolean(nav && active && nav.contains(active)),
      backgroundInert: Boolean(
        main?.closest("[inert]") ?? main?.hasAttribute("inert"),
      ),
      mainScrollLocked: main
        ? getComputedStyle(main).overflowY === "hidden"
        : null,
    };
  });
  // 连续按二十次 Tab，焦点不能跑到抽屉外面去。
  // 必须用真键盘：合成的 KeyboardEvent 不会移动焦点，量出来的是假的。
  let focusEscaped = false;
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const nav = document.querySelector('dialog[aria-label="更多"]');
      const active = document.activeElement;
      return Boolean(nav && active && nav.contains(active));
    });
    if (!inside) {
      focusEscaped = true;
      break;
    }
  }
  const drawer = { ...drawerState, focusEscaped };
  // 抽屉打开时按钮被盖住，点它关不了 —— 用 Esc（应用自己支持）。
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  drawer.focusRestored = await trigger.evaluate(
    (element) => document.activeElement === element,
  );

  const commandTrigger = page.locator(
    "[data-command-trigger][aria-keyshortcuts]:visible",
  );
  await commandTrigger.click();
  await page.getByRole("dialog", { name: "命令面板" }).waitFor();

  const keyboard = await page.evaluate(async () => {
    const input = document.querySelector(
      "[role=dialog][aria-label=命令面板] input",
    );
    if (!input) return { skipped: "这一页没有输入框" };
    input.focus();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const viewport = window.visualViewport;
    const limit = viewport ? viewport.height : window.innerHeight;
    const rect = input.getBoundingClientRect();
    return {
      covered: rect.bottom > limit + 1,
      bottom: Math.round(rect.bottom),
      limit: Math.round(limit),
    };
  });

  await page.keyboard.press("Escape");
  const commandFocusRestored = await commandTrigger.evaluate(
    (element) =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(document.activeElement === element),
          ),
        ),
      ),
  );
  await page.goto(BASE + "/photo/library", { waitUntil: "domcontentloaded" });
  const folderTrigger = page.getByRole("button", { name: "目录", exact: true });
  await folderTrigger.click();
  const folders = page.getByRole("dialog", { name: "目录抽屉" });
  await folders.waitFor();
  const folder = await folders.evaluate((element) => {
    const main = document.querySelector(".app-main");
    return {
      focusInside: element.contains(document.activeElement),
      backgroundInert: Boolean(main?.closest("[inert]")),
      mainScrollLocked: getComputedStyle(main).overflowY === "hidden",
    };
  });
  await page.keyboard.press("Shift+Tab");
  folder.focusInside &&= await folders.evaluate((element) =>
    element.contains(document.activeElement),
  );
  await page.keyboard.press("Escape");
  await folders.waitFor({ state: "hidden" });
  folder.focusRestored = await folderTrigger.evaluate(
    (element) => document.activeElement === element,
  );
  return { drawer, keyboard, commandFocusRestored, folder };
}

async function setTheme(page, theme) {
  await page.evaluate(
    ({ t, vm }) => {
      const raw = localStorage.getItem("local-gallery-ui");
      const parsed = raw ? JSON.parse(raw) : { state: {} };
      parsed.state = {
        ...(parsed.state ?? {}),
        theme: t,
        viewMode: vm,
        folderDrawerOpen: false,
        sidebar: "expanded",
      };
      localStorage.setItem("local-gallery-ui", JSON.stringify(parsed));
    },
    { t: theme, vm: VIEWMODE },
  );
}

// 相册详情页的 id 每次运行都不同：现从媒体根的子节点里取一本图多的相册。
async function resolveAlbumRoute(page, mode) {
  const id = await resolveAlbumId(page, mode);
  return id ? `/${mode}/albums/${encodeURIComponent(id)}` : null;
}

// 进入阅读器：阅读器是沉浸场景（顶栏 + 画面 + 浮动工具条 + 底部翻页条），
// 它的控件尺寸与字号自成一套，从没被布局审计量过。
//
// 阅读器只属于漫画侧，地址是 /comic/read/<相册 id>，直接构造即可，
// 不必先经过相册页。库里没有漫画相册时跳过这一项。
// 用 domcontentloaded 而不是 networkidle —— 阅读器里有 SSE 与预览图请求，
// networkidle 会一直等不到。
async function openReader(page) {
  const albumId = await resolveAlbumId(page, "comic");
  if (!albumId) return false;
  await page.goto(`${BASE}/comic/read/${encodeURIComponent(albumId)}?index=0`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  // 等画面与工具条渲染完。
  const opened = await page
    .waitForURL(/\/comic\/read\//, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return false;
  await page.waitForTimeout(1500);
  return true;
}

// 标签页的数据来源。
//
// 真实库里**有**标签时就用真的（e2e 造的临时库就有：测试 / 空 格 / C++ …），
// 只有库里一个标签都没有时，才用仪表盘里的真实相册伪造一份 —— 伪造数据
// 只能验证版式，验证不了"标签名很长 / 带特殊字符"时的真实表现。
// 用了哪种数据会在输出里写明，免得把伪造结果当成真实结果。
let tagAuditState = { tag: null, faked: false };

async function resolveTagName(page, mode) {
  const res = await page.request.get(`${BASE}/api/tags?kind=${mode}`);
  if (res.ok()) {
    const body = await res.json();
    const items = body?.page?.items ?? [];
    const hit = items.find((t) => t && t.tag && (t.count ?? 0) > 0) ?? items[0];
    if (hit?.tag) return { tag: hit.tag, faked: false };
  }
  return { tag: "审计用标签", faked: true };
}

async function prepareTagRoute(page, mode) {
  const state = await resolveTagName(page, mode);
  tagAuditState = state;
  if (!state.faked) return; // 真实数据：不用拦截
  await page.route(
    (url) =>
      url.pathname.includes("/api/tags/") && url.pathname.endsWith("/albums"),
    async (route) => {
      // 伪造的数据用当前模式下的真实相册：封面与版式都能量到，
      // 空列表只能量到一个空页面。
      const data = await page.evaluate(async (kind) => {
        const manifestRes = await fetch("/api/library/manifest");
        const manifest = await manifestRes.json();
        const root = (manifest.manifest?.roots ?? []).find(
          (r) => (r.contentKind ?? "photo") === kind,
        );
        if (!root) return { revision: 0, items: [], total: 0 };
        const res = await fetch(
          `/api/library/${encodeURIComponent(root.id)}/children?kind=${kind}&limit=12`,
        );
        const body = await res.json();
        const items = body.page?.items ?? [];
        return {
          revision: body.page?.revision ?? 0,
          items,
          total: items.length,
        };
      }, mode);
      await route.fulfill({ json: { ok: true, page: data } });
    },
  );
}

async function main() {
  const browser = await chromium.launch();
  if (process.argv.includes("--self-test")) {
    try {
      const page = await browser.newPage();
      for (const [variant, width] of Object.entries({
        standard: 1440,
        system: 1440,
        gallery: "none",
        focused: 760,
        workspace: "none",
      })) {
        for (const valid of [true, false]) {
          await page.setContent(
            '<main><div data-page="' +
              variant +
              '" style="max-width:' +
              (valid && width === "none" ? "none" : ((valid ? width : 100) + "px")) +
              '">内容</div></main>',
          );
          const result = await page.evaluate(MEASURE, {
            minFontPx: MIN_FONT_PX,
            minControlPx: MIN_CONTROL_PX,
          });
          assert.equal(
            result.chromeIssues.some((issue) => issue.includes("页面容器")),
            !valid,
          );
        }
      }
      // 门禁判据本身的样本：容器认 [data-page]；读屏专用元素与
      // 勾选框本体不算太小的控件；低于最小字号档的文字要被抓出来；
      // 行内链接不算控件，独立成行的链接算。
      await page.setContent(
        "<style>body{margin:0}[data-page]{width:800px;padding:0 24px}</style>" +
          '<main><div data-page="standard"><p style="font-size:11px">徽章</p>' +
          '<button style="height:20px">小按钮</button>' +
          '<input class="sr-only" style="width:1px;height:1px">' +
          '<input type="checkbox" style="width:13px;height:13px">' +
          '<p>正文里的<a href="/inline">行内链接</a>。</p>' +
          '<a href="/block" style="display:block;height:20px">独立链接</a>' +
          "</div></main>",
      );
      const gate = await page.evaluate(MEASURE, {
        minFontPx: MIN_FONT_PX,
        minControlPx: MIN_CONTROL_PX,
        touch: true,
        minTouchTargetPx: MIN_TOUCH_TARGET_PX,
      });
      assert.equal(gate.shellLeft, 0);
      assert.equal(
        gate.tinyText.some((t) => t.size < MIN_FONT_PX),
        true,
      );
      assert.equal(gate.smallControlsTotal, 2);
      assert.equal(gate.smallControls[0].text, "小按钮");
      assert.equal(
        gate.smallControls.some((c) => c.text === "行内链接"),
        false,
      );
      console.log("布局审计 self-test：四类容器、错误宽度与文字控件门禁通过");
    } finally {
      await browser.close();
    }
    return;
  }
  const report = [];
  const routeErrors = [];
  const chromeViolations = [];
  // 触摸档的外壳检查（抽屉、软键盘）：与页面无关，一个页面上量一次。
  const shellChecks = [];
  // 三条门禁的失败清单（字号、控件高度、命中区）。
  const fontViolations = [];
  const controlViolations = [];
  const touchViolations = [];
  const drawerViolations = [];
  const keyboardViolations = [];
  let failed = false;

  for (const theme of THEMES) {
    for (const profile of PROFILES) {
      const viewport = profile.viewport;
      const ctx = await browser.newContext({
        viewport,
        hasTouch: profile.hasTouch,
        deviceScaleFactor: profile.deviceScaleFactor,
        locale: "zh-CN",
        colorScheme: theme,
      });
      const page = await ctx.newPage();
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      // 工作台模式决定路由前缀：两侧的页面各在 /photo 与 /comic 下。
      const mode = await resolveMode(page);

      await prepareTagRoute(page, mode);
      if (viewport.width >= 1024) {
        const rail = page.getByTestId("nav-rail");
        await rail.waitFor();
        const initial = (await rail.getAttribute("data-collapsed")) === "true";
        for (const collapsed of [!initial, initial]) {
          await page.keyboard.press("Control+b");
          await page.waitForFunction(
            ({ collapsed, width }) => {
              const nav = document.querySelector('[data-testid="nav-rail"]');
              return (
                nav?.dataset.collapsed === String(collapsed) &&
                Math.abs(nav.getBoundingClientRect().width - width) <= 1
              );
            },
            { collapsed, width: collapsed ? 72 : 240 },
          );
        }
      }

      for (const route of PAGES) {
        // 未读页只属于漫画工作台：照片侧没有这个路由，硬走会落回首页，
        // 量到的还是首页的数据。直接跳过。
        if (route === "/unread" && mode !== "comic") {
          console.log(`  · 跳过 ${theme} /unread：只有漫画工作台有未读页`);
          continue;
        }
        // 智能相册墙只属于照片侧：分组线索来自照片的元数据与人脸分析。
        if (route === "/smart-albums" && mode !== "photo") {
          console.log(
            `  · 跳过 ${theme} /smart-albums：只有照片工作台有智能相册墙`,
          );
          continue;
        }
        // 漫画侧没有相册网格页：/comic/albums/:id 直接进阅读器（沉浸场景，
        // 不在 AppShell 下，通栏）。它已由 reader 一条单独审计，通栏页面
        // 本来也不参与跨页容器比较 —— 这里量到的只会是阅读器第二遍。
        if (route === "album" && mode === "comic") {
          console.log(
            `  · 跳过 ${theme} album：漫画侧打开一卷直接进阅读器（reader 已单独审计）`,
          );
          continue;
        }
        if (route === "viewer") {
          if (!(await openPhotoViewer(page, BASE))) {
            console.log("  · 当前图库缺少可预览的照片");
            continue;
          }
        } else if (route === "reader") {
          if (!(await openReader(page))) {
            console.log(`  · 跳过 ${theme} reader：库里没有漫画相册`);
            continue;
          }
        } else {
          // 伪路由 album：相册详情页的 id 运行时现取。
          // 伪路由 tag：标签页用固定的标签名，数据由 prepareTagRoute 伪造。
          const target =
            route === "album"
              ? await resolveAlbumRoute(page, mode)
              : route === "tag"
                ? `/${mode}/tags/${encodeURIComponent(tagAuditState.tag)}`
                : buildRoute(route, mode);
          if (!target) {
            console.log(`  · 跳过 ${theme} ${route}：库里没有可打开的相册`);
            continue;
          }
          // 不用 networkidle：页面含 SSE 长连接，且 /api/previews 首次生成
          // 预览图可能耗时数秒，networkidle 会一直等不到而超时。
          await page.goto(BASE + target, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          await page
            .waitForFunction(
              () =>
                Array.from(document.images).every(
                  (img) => img.complete || img.loading === "lazy",
                ),
              undefined,
              { timeout: 20000 },
            )
            .catch(() => {});
          await page.waitForTimeout(900);
        }
        await page
          .locator("main [data-page], .reader-shell")
          .first()
          .waitFor({ state: "visible", timeout: 20000 });
        let m = await page.evaluate(MEASURE, {
          minFontPx: MIN_FONT_PX,
          minControlPx: MIN_CONTROL_PX,
          touch: profile.hasTouch,
          minTouchTargetPx: MIN_TOUCH_TARGET_PX,
        });
        // 偶发的渲染异常（相册页的虚拟列表爆栈）重试一次再判：
        // 重试后仍然报错才算这一页真的坏了。
        if (m.routeError) {
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForTimeout(900);
          m = await page.evaluate(MEASURE, {
            minFontPx: MIN_FONT_PX,
            minControlPx: MIN_CONTROL_PX,
            touch: profile.hasTouch,
            minTouchTargetPx: MIN_TOUCH_TARGET_PX,
          });
        }
        report.push({
          theme,
          route,
          vp: profile.label,
          ...m,
        });
        if (m.overflowPx > 0) failed = true;
        if (m.chromeIssues.length)
          chromeViolations.push({
            theme,
            route,
            vp: profile.label,
            issues: m.chromeIssues,
          });
        // 字号门禁：低于最小一档（徽章档）就算越界。
        if ((m.tinyText ?? []).some((t) => t.size < MIN_FONT_PX)) {
          fontViolations.push({ theme, route, vp: profile.label });
        }
        // 控件高度门禁：桌面档 32px 是本仓的下限。
        if (m.smallControlsTotal > 0) {
          controlViolations.push({
            theme,
            route,
            vp: profile.label,
            controls: m.smallControls,
          });
        }
        // 命中区门禁：触摸档的有效命中区必须够 40×40。
        if (m.touchTargetsTotal > 0) {
          touchViolations.push({ theme, route, vp: profile.label });
        }
        if (m.routeError) {
          routeErrors.push({
            theme,
            route,
            vp: profile.label,
          });
        }
      }
      // 触摸档：抽屉开合与软键盘遮挡只跟外壳有关，一个页面上量一次就够。
      if (profile.hasTouch) {
        await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
        const shell = await checkMobileShell(page);
        shellChecks.push({ theme, vp: profile.label, ...shell });
        const drawer = shell.drawer ?? {};
        const keyboard = shell.keyboard ?? {};
        if (
          drawer.opened &&
          (drawer.focusEscaped ||
            !drawer.backgroundInert ||
            !drawer.mainScrollLocked ||
            !drawer.focusInside ||
            !drawer.focusRestored ||
            !shell.commandFocusRestored)
        ) {
          drawerViolations.push({ theme, vp: profile.label, ...drawer });
        }
        if (
          shell.folder &&
          Object.values(shell.folder).some((result) => !result)
        ) {
          drawerViolations.push({
            theme,
            vp: profile.label,
            folder: shell.folder,
          });
        }
        if (keyboard.covered) {
          keyboardViolations.push({ theme, vp: profile.label, ...keyboard });
        }
      }
      await ctx.close();
    }
  }
  await browser.close();

  const asJson = process.argv.includes("--json");
  if (asJson) {
    console.log(JSON.stringify({ report, shellChecks }, null, 2));
  } else {
    console.log(
      [
        "断点          主题   路由        内容宽  占比   左右留白  有效宽 有效左 有效右 右留白  溢出  <12px文本  小控件",
        ...report.map((r) =>
          [
            r.vp.padEnd(14),
            r.theme.padEnd(6),
            r.route.padEnd(11),
            String(r.contentWidth).padEnd(7),
            `${(r.contentWidthRatio * 100).toFixed(1)}%`.padEnd(6),
            String(r.gutter).padEnd(9),
            String(r.effectiveWidth ?? "-").padEnd(7),
            String(r.effectiveLeft ?? "-").padEnd(7),
            String(r.effectiveRight ?? "-").padEnd(7),
            String(r.rightGap ?? "-").padEnd(7),
            String(r.overflowPx).padEnd(5),
            String(r.tinyTextTotal).padEnd(11),
            String(r.smallControlsTotal),
          ].join(" "),
        ),
      ].join("\n"),
    );
    console.log("");
    if (routeErrors.length === 0) {
      console.log("✓ 页面加载：所有路由都正常渲染。");
    } else {
      console.log(
        `✗ 页面加载失败：${routeErrors.length} 处（重试后仍掉进错误边界）`,
      );
      for (const e of routeErrors) {
        console.log(`  · ${e.vp} ${e.theme} ${e.route}`);
      }
    }
    for (const r of report) {
      const sizes = r.fontSizeCounts
        .map((f) => `${f.size}px×${f.count}`)
        .join(" ");
      console.log(`${r.vp} ${r.theme} ${r.route} 字号分布: ${sizes}`);
    }
    // 触摸档的两项指标：命中区与外壳可达性（都已进门禁）。
    const touchRows = report.filter((r) => r.touchTargetsTotal > 0);
    if (touchRows.length > 0) {
      console.log("");
      console.log("触摸档：有效命中区不足 40×40 的控件");
      for (const r of touchRows) {
        const list = r.touchTargets
          .map((t) => `${t.text || "(无文字)"} ${t.w}×${t.h}`)
          .join("，");
        console.log(
          `  · ${r.vp} ${r.theme} ${r.route}：${r.touchTargetsTotal} 处 —— ${list}`,
        );
      }
    }
    if (shellChecks.length > 0) {
      console.log("");
      console.log("触摸档：外壳可达性");
      for (const c of shellChecks) {
        const drawer = c.drawer;
        console.log(
          `  · ${c.vp} ${c.theme} 抽屉：${drawer.skipped ?? `打开=${drawer.opened} 焦点在内=${drawer.focusInside} 焦点跑出=${drawer.focusEscaped} 背景inert=${drawer.backgroundInert} 正文锁滚=${drawer.mainScrollLocked}`}`,
        );
        const keyboard = c.keyboard;
        console.log(
          `  · ${c.vp} ${c.theme} 软键盘：${keyboard.skipped ?? `被遮=${keyboard.covered}（底边 ${keyboard.bottom} / 可视高 ${keyboard.limit}）`}`,
        );
      }
    }
  }
  if (chromeViolations.length > 0) {
    console.error("\n外壳与页头几何门禁未通过", chromeViolations);
    process.exit(1);
  }
  if (failed) {
    console.error("\n存在横向溢出。");
    process.exit(1);
  }
  if (routeErrors.length > 0) {
    console.error("\n存在加载失败的页面。");
    process.exit(1);
  }
  if (fontViolations.length > 0) {
    console.error(
      `
存在低于最小字号档（${MIN_FONT_PX}px）的文字：${fontViolations
        .map((v) => `${v.vp} ${v.theme} ${v.route}`)
        .join("，")}`,
    );
    process.exit(1);
  }
  if (controlViolations.length > 0) {
    console.error(JSON.stringify(controlViolations.slice(0, 12)));
    console.error(
      `
存在高度不足 ${MIN_CONTROL_PX}px 的控件：${controlViolations
        .map((v) => `${v.vp} ${v.theme} ${v.route}`)
        .join("，")}`,
    );
    process.exit(1);
  }
  if (touchViolations.length > 0) {
    console.error(
      `
存在有效命中区不足 ${MIN_TOUCH_TARGET_PX}×${MIN_TOUCH_TARGET_PX} 的控件：${touchViolations
        .map((v) => `${v.vp} ${v.theme} ${v.route}`)
        .join("，")}`,
    );
    process.exit(1);
  }
  if (drawerViolations.length > 0) {
    console.error(
      `
存在模态语义不完整的抽屉：${drawerViolations
        .map((v) => `${v.vp} ${v.theme}`)
        .join("，")}`,
    );
    process.exit(1);
  }
  if (keyboardViolations.length > 0) {
    console.error(
      `
存在被软键盘遮住的输入框：${keyboardViolations
        .map((v) => `${v.vp} ${v.theme}`)
        .join("，")}`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
