// 布局与排版审计：量化内容宽度、字号、溢出等技术指标，不评价设计是否好看。
// 当前跨页左缘检查服务于现有容器方案；重设计可同步调整该假设与适用页面，见 docs/DESIGN.md。
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
//   - tinyText[]        : 实际渲染字号 < 12.5px 的可见文本（中文可读性下限）
//   - controlHeights    : 可交互控件的实际高度分布（触控目标是否达标）
//   - touchTargets[]    : 触摸档下有效命中区不足 44×44 的控件
//   - overflowPx        : 横向溢出像素
//
// 退出码：横向溢出、跨页对齐基线失败、容器不一致或页面加载失败时为 1。
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import {
  buildRoute,
  resolveAlbumId,
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
  "/,/recents,/favorites,/unread,/settings/interface,/settings/reading,/settings/data,/settings/server,/tasks/run,/tasks/plan,/tasks/history,/tasks/storage,/travels,/smart-albums,album,reader,tag"
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

const MIN_FONT_PX = 12.5;
// 门禁阈值：低于最小一档字号（tokens.css 的 --text-badge，徽章与键帽
// 用的那一档）才算越界。12.5px 是正文的下限，徽章一档是设计上允许的
// 例外 —— 门禁卡的是「比设计允许的还小」。
const MIN_FONT_FAIL_PX = 11.5;
const MIN_CONTROL_PX = 28;
// 手指点的不是一个按钮，而是按钮周围约 44×44 的一块。
const MIN_TOUCH_TARGET_PX = 44;

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

  // 主内容容器：页面级容器优先（.page-layout--page，超宽档上首页的
  // 那一层），其次正文里的第一个 .page-shell，再退回 <main> 与 body。
  // 取第一个有实际宽度的 —— .page-layout 在窄屏上是 display: contents，
  // 没有盒子。
  const shellCandidates = [
    main?.querySelector(".page-layout--page"),
    main?.querySelector(".page-shell"),
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
  // 行内链接不算控件：它的盒子就是文字所在的那一行的行盒，撑到 28px
  // （或触摸档的 44px）会把段落撑散。独立成行的链接（卡片标题、
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
    if (rect.height < minControlPx) {
      const cls = String(el.className || "");
      const tag = el.tagName.toLowerCase();
      const isHiddenForScreenReader = cls.includes("sr-only");
      const isCheckable =
        tag === "input" &&
        ["checkbox", "radio"].includes(el.getAttribute("type") ?? "");
      if (!isHiddenForScreenReader && !isCheckable && !isInlineLink(el)) {
        smallControlList.push({
          h: Math.round(rect.height * 10) / 10,
          text,
          cls: cls.slice(0, 60),
          tag,
        });
      }
    }
    controlHeights.push({ h: Math.round(rect.height * 10) / 10, text });
  }

  // 有效命中区（只在触摸档量）：手指点的是控件周围约 44×44 的一块，
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
      // 本体就够大的控件不用查：它的 44×44 中心区必然落在自己身上，
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
  );

  const viewportWidth = window.innerWidth;
  const contentWidth = Math.round(shellRect.width);
  const gutter = Math.max(0, Math.round((viewportWidth - contentWidth) / 2));

  return {
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
      effectiveRight === null ? null : Math.round(viewportWidth - effectiveRight),
    // 照片墙页头以返回按钮开头；文字左缘会多出按钮宽度，比较容器边界。
    alignmentLeft: main?.querySelector(".album-bar") ? Math.round(main.querySelector(".album-bar").getBoundingClientRect().left) : effectiveLeft,
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
  const trigger = page.locator('button[aria-label="打开导航"]');
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
    const nav = document.querySelector('aside[aria-label="主导航"]');
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
      const nav = document.querySelector('aside[aria-label="主导航"]');
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

  const keyboard = await page.evaluate(async () => {
    const input = document.querySelector(
      'input:not([type="hidden"]):not([disabled]), textarea',
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

  return { drawer, keyboard };
}

async function setTheme(page, theme) {
  await page.evaluate(
    ({ t, vm }) => {
      const raw = localStorage.getItem("local-gallery-ui");
      const parsed = raw ? JSON.parse(raw) : { state: {} };
      parsed.state = { ...(parsed.state ?? {}), theme: t, viewMode: vm };
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
      for (const [offset, expected] of [[0,20],[12,32]]) {
        await page.setContent(`<style>body{margin:0}.album-bar{display:flex;margin-left:${offset}px}button{width:45px;height:30px}h1{margin:0}</style><main style="padding:20px"><div class="album-bar"><button aria-label="返回"></button><h1>相册</h1></div></main>`);
        const result = await page.evaluate(MEASURE,{minFontPx:MIN_FONT_PX,minControlPx:MIN_CONTROL_PX});
        assert.equal(result.alignmentLeft,expected);
        assert.equal(Math.abs(result.alignmentLeft-20)>2,offset!==0);
      }
      await page.setContent('<style>body{margin:0}h1{margin:0}</style><main style="padding:20px"><h1>列表</h1></main>');
      const result=await page.evaluate(MEASURE,{minFontPx:MIN_FONT_PX,minControlPx:MIN_CONTROL_PX});
      assert.equal(result.alignmentLeft,20);
      // 门禁判据本身的样本：容器认 .page-layout--page；读屏专用元素与
      // 勾选框本体不算太小的控件；低于最小字号档的文字要被抓出来；
      // 行内链接不算控件，独立成行的链接算。
      await page.setContent(
        '<style>body{margin:0}.page-layout--page{width:800px;padding:0 24px}</style>' +
          '<main><div class="page-layout--page"><p style="font-size:11px">徽章</p>' +
          '<button style="height:20px">小按钮</button>' +
          '<input class="sr-only" style="width:1px;height:1px">' +
          '<input type="checkbox" style="width:13px;height:13px">' +
          '<p>正文里的<a href="/inline">行内链接</a>。</p>' +
          '<a href="/block" style="display:block;height:20px">独立链接</a>' +
          '</div></main>',
      );
      const gate = await page.evaluate(MEASURE, {
        minFontPx: MIN_FONT_PX,
        minControlPx: MIN_CONTROL_PX,
        touch: true,
        minTouchTargetPx: MIN_TOUCH_TARGET_PX,
      });
      assert.equal(gate.shellLeft, 0);
      assert.equal(gate.tinyText.some((t) => t.size < MIN_FONT_FAIL_PX), true);
      assert.equal(gate.smallControlsTotal, 2);
      assert.equal(gate.smallControls[0].text, "小按钮");
      assert.equal(
        gate.smallControls.some((c) => c.text === "行内链接"),
        false,
      );
      console.log(
        "布局审计 self-test：普通列表、带返回按钮的照片墙、错误偏移、门禁判据均通过",
      );
    } finally { await browser.close(); }
    return;
  }
  const report = [];
  const routeErrors = [];
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
        if (route === "reader") {
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
                  (img) => !img.complete || img.naturalWidth > 0,
                ),
              undefined,
              { timeout: 20000 },
            )
            .catch(() => {});
          await page.waitForTimeout(900);
        }
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
        // 字号门禁：低于最小一档（徽章档）就算越界。
        if ((m.tinyText ?? []).some((t) => t.size < MIN_FONT_FAIL_PX)) {
          fontViolations.push({ theme, route, vp: profile.label });
        }
        // 控件高度门禁：桌面档 28px 是本仓的下限。
        if (m.smallControlsTotal > 0) {
          controlViolations.push({ theme, route, vp: profile.label });
        }
        // 命中区门禁：触摸档的有效命中区必须够 44×44。
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
            !drawer.mainScrollLocked)
        ) {
          drawerViolations.push({ theme, vp: profile.label, ...drawer });
        }
        if (keyboard.covered) {
          keyboardViolations.push({ theme, vp: profile.label, ...keyboard });
        }
      }
      await ctx.close();
    }
  }
  await browser.close();

  // 当前容器方案的回归基线：同断点跨页左缘一致，阅读器除外。
  // 有意采用不同页面布局时同步更新适用范围；这不是不可更改的设计要求。
  const misaligned = [];
  {
    const groups = new Map();
    for (const r of report) {
      if (r.route === "reader" || r.alignmentLeft === null) continue;
      const key = `${r.vp}|${r.theme}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, rows] of groups) {
      const counts = new Map();
      for (const r of rows) {
        counts.set(r.alignmentLeft, (counts.get(r.alignmentLeft) ?? 0) + 1);
      }
      // 多数派就是这一档的网格线
      let baseline = null;
      let best = -1;
      for (const [left, n] of counts) {
        if (n > best) {
          best = n;
          baseline = left;
        }
      }
      for (const r of rows) {
        if (r.routeError) continue; // 页面本身崩了，不参与对齐比较
        if (Math.abs(r.alignmentLeft - baseline) > 2) {
          misaligned.push({
            vp: r.vp,
            theme: r.theme,
            route: r.route,
            effectiveLeft: r.alignmentLeft,
            expected: baseline,
          });
        }
      }
    }
  }

  // 容器一致性：同一断点下每一页的内容容器必须是同一个盒子 ——
  // 左右边界逐页相等。左右留白不一致的根因就是这里：某一页套了
  // 另一套容器（窄壳或通栏），左右留白立刻差出一截。
  const containerMismatch = [];
  {
    const groups = new Map();
    for (const r of report) {
      if (r.route === "reader" || r.routeError) continue;
      const key = `${r.vp}|${r.theme}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, rows] of groups) {
      const lefts = new Set(rows.map((r) => r.shellLeft));
      const rights = new Set(rows.map((r) => r.shellRight));
      if (lefts.size > 1 || rights.size > 1) {
        for (const r of rows) {
          containerMismatch.push({
            vp: r.vp,
            theme: r.theme,
            route: r.route,
            shell: `${r.shellLeft}–${r.shellRight}`,
          });
        }
      }
    }
  }

  const asJson = process.argv.includes("--json");
  if (asJson) {
    console.log(JSON.stringify({ report, shellChecks }, null, 2));
  } else {
    console.log(
      [
        "断点          主题   路由        内容宽  占比   左右留白  有效宽 有效左 有效右 右留白  溢出  <12.5px文本  小控件",
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
    if (misaligned.length === 0) {
      console.log("✓ 内容左缘对齐：同一断点下所有页面落在同一条网格线上。");
    } else {
      console.log(
        `✗ 内容左缘不对齐：${misaligned.length} 处（同一断点下不同页面的内容左缘相差超过 2px）`,
      );
      for (const m of misaligned) {
        console.log(
          `  · ${m.vp} ${m.theme} ${m.route}：内容左缘 ${m.effectiveLeft}，本档网格线 ${m.expected}`,
        );
      }
    }
    if (containerMismatch.length === 0) {
      console.log("✓ 内容容器一致：同一断点下所有页面的左右留白相同。");
    } else {
      console.log(
        `✗ 内容容器不一致：${containerMismatch.length} 处（同一断点下不同页面的容器边界不同）`,
      );
      for (const c of containerMismatch) {
        console.log(
          `  · ${c.vp} ${c.theme} ${c.route}：容器 ${c.shell}（左右边界应逐页相同）`,
        );
      }
    }
    console.log("");
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
      console.log("触摸档：有效命中区不足 44×44 的控件");
      for (const r of touchRows) {
        const list = r.touchTargets
          .map((t) => `${t.text || "(无文字)"} ${t.w}×${t.h}`)
          .join("，");
        console.log(`  · ${r.vp} ${r.theme} ${r.route}：${r.touchTargetsTotal} 处 —— ${list}`);
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
  if (failed) {
    console.error("\n存在横向溢出。");
    process.exit(1);
  }
  if (misaligned.length > 0) {
    console.error("\n存在内容左缘不对齐的页面。");
    process.exit(1);
  }
  if (containerMismatch.length > 0) {
    console.error("\n存在内容容器不一致的页面。");
    process.exit(1);
  }
  if (routeErrors.length > 0) {
    console.error("\n存在加载失败的页面。");
    process.exit(1);
  }
  if (fontViolations.length > 0) {
    console.error(
      `
存在低于最小字号档（${MIN_FONT_FAIL_PX}px）的文字：${fontViolations
        .map((v) => `${v.vp} ${v.theme} ${v.route}`)
        .join("，")}`,
    );
    process.exit(1);
  }
  if (controlViolations.length > 0) {
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
