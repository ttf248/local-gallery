import type { Config } from "tailwindcss";

// 保留完整 CSS 颜色 token，同时让 /30 等透明度修饰符参与生成。
const tokenColor = (name: string) =>
  `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  future: {
    // 触屏没有悬停。hover 变体（连同 group-hover）只在
    // (hover: hover) and (pointer: fine) 下生效，否则点一下按钮
    // 底色就粘住不放 —— 手机上那一下「按下去」永远是「按住了」。
    // 靠悬停才出现的元素因此要在触摸端另有安排，见 styles/primitives.css
    // 的 .hover-reveal 与 .mouse-only。
    hoverOnlyWhenSupported: true,
  },
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1440px",
      "2xl": "1920px",
      "3xl": "2560px",
    },
    extend: {
      spacing: {
        rail: "var(--nav-width)",
        "rail-compact": "var(--nav-width-compact)",
        topbar: "var(--topbar-height)",
        tabbar: "var(--tabbar-height)",
      },
      zIndex: Object.fromEntries(
        [
          "rail",
          "topbar",
          "tabbar",
          "popover",
          "sheet",
          "dialog",
          "viewer",
          "toast",
        ].map((k) => [k, "var(--z-" + k + ")"]),
      ),
      transitionDuration: {
        1: "var(--dur-1)",
        2: "var(--dur-2)",
        3: "var(--dur-3)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
        exit: "var(--ease-exit)",
      },
      textColor: {
        ...Object.fromEntries(
          ["success", "warning", "danger", "favorite", "signal"].map((name) => [
            name,
            tokenColor(name + "-text"),
          ]),
        ),
      },
      colors: {
        line: tokenColor("line"),
        "line-strong": tokenColor("line-strong"),
        signal: tokenColor("signal"),
        "signal-soft": tokenColor("signal-soft"),
        "inverse-bg": tokenColor("inverse-bg"),
        "inverse-fg": tokenColor("inverse-fg"),
        // 主题颜色统一从 tokens.css 取得，不在工具类中重复维护色值。
        bg: tokenColor("bg"),
        "bg-elevated": tokenColor("bg-elevated"),
        "bg-subtle": tokenColor("bg-subtle"),
        "bg-strong": tokenColor("bg-strong"),
        "bg-media": tokenColor("bg-media"),
        fg: tokenColor("fg"),
        "fg-muted": tokenColor("fg-muted"),
        "fg-subtle": tokenColor("fg-subtle"),
        "surface-glass": tokenColor("surface-glass"),
        "surface-card": tokenColor("surface-card"),
        "accent-muted": tokenColor("accent-muted"),
        scrim: tokenColor("scrim"),
        accent: tokenColor("accent"),
        "accent-hover": tokenColor("accent-hover"),
        "accent-soft": tokenColor("accent-soft"),
        // 压在强调色淡底上的文字色：直接用 accent 只有 4.6:1，
        // 12.5px 的小字贴着 AA 下限走。
        "accent-ink": tokenColor("accent-ink"),
        "accent-contrast": tokenColor("accent-contrast"),
        border: tokenColor("border"),
        "border-strong": tokenColor("border-strong"),
        "border-faint": tokenColor("border-faint"),
        danger: tokenColor("danger"),
        "danger-ink": tokenColor("danger-ink"),
        success: tokenColor("success"),
        warning: tokenColor("warning"),
        favorite: tokenColor("favorite"),
        focus: tokenColor("focus"),
        "rail-bg": tokenColor("rail-bg"),
        "rail-fg": tokenColor("rail-fg"),
        "rail-muted": tokenColor("rail-muted"),
        "rail-hover": tokenColor("rail-hover"),
        "rail-line": tokenColor("rail-line"),
        "rail-active": tokenColor("rail-active"),
        "rail-active-fg": tokenColor("rail-active-fg"),
        "rail-accent": tokenColor("rail-accent"),
        "rail-accent-fg": tokenColor("rail-accent-fg"),
        "reader-bg": tokenColor("reader-bg"),
        "reader-panel": tokenColor("reader-panel"),
        "overlay-bg": tokenColor("overlay-bg"),
        "overlay-panel": tokenColor("overlay-panel"),
        "overlay-panel-strong": tokenColor("overlay-panel-strong"),
        "overlay-border": tokenColor("overlay-border"),
        "overlay-fg": tokenColor("overlay-fg"),
        "overlay-scrim": tokenColor("overlay-scrim"),
        "overlay-danger": tokenColor("overlay-danger"),
        "overlay-warning": tokenColor("overlay-warning"),
        "overlay-success": tokenColor("overlay-success"),
        "overlay-favorite": tokenColor("overlay-favorite"),
      },
      // 圆角数值只有一份来源（tokens.css 的语义 token）。Tailwind 侧保留
      // 数字档名，避免同一个圆角出现「rounded-lg」和「rounded-tile」两套
      // 叫法；样式表内部一律用语义名 var(--radius-tile) 之类。
      // 卡片与面板同属一档（12px），xl 是 lg 的别名。
      borderRadius: {
        DEFAULT: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        tile: "var(--radius-tile)",
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        sheet: "var(--radius-sheet)",
        full: "var(--radius-pill)",
        media: "var(--radius-media)",
        md: "var(--radius-control)",
        lg: "var(--radius-tile)",
        xl: "var(--radius-tile)",
      },
      fontSize: {
        badge: "var(--text-badge)",
        meta: "var(--text-meta)",
        display: [
          "var(--text-display)",
          { lineHeight: "48px", letterSpacing: "-0.035em", fontWeight: "650" },
        ],
        "title-1": [
          "var(--text-title-1)",
          {
            lineHeight: "calc(var(--text-title-1) + 8px)",
            letterSpacing: "-0.03em",
            fontWeight: "650",
          },
        ],
        "title-2": [
          "var(--text-title-2)",
          { lineHeight: "30px", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "title-3": [
          "var(--text-title-3)",
          { lineHeight: "24px", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        body: [
          "var(--text-body)",
          { lineHeight: "24px", letterSpacing: "0em", fontWeight: "400" },
        ],
        callout: [
          "var(--text-callout)",
          { lineHeight: "20px", letterSpacing: "0em", fontWeight: "500" },
        ],
        caption: [
          "var(--text-caption)",
          { lineHeight: "18px", letterSpacing: "0em", fontWeight: "400" },
        ],
        micro: [
          "var(--text-micro)",
          { lineHeight: "16px", letterSpacing: "0.01em", fontWeight: "500" },
        ],
        label: "var(--text-label)",
        section: "var(--text-section)",
        "page-sm": "var(--text-page-sm)",
        page: "var(--text-page)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",

        float: "var(--shadow-float)",
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  // 明暗主题不走 Tailwind 的 dark: 变体，全部由 tokens.css 的 CSS 变量
  // 与 :root[data-theme="dark"] 承担。因此这里不配 darkMode —— 配了
  // 会让人以为存在 dark: 工具类的工作流，实际一条都用不上。
  plugins: [],
} satisfies Config;
