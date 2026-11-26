import { COLOR_ROLES } from "./src/styles/tokens";
import plugin from "tailwindcss/plugin";
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

    hoverOnlyWhenSupported: true,
  },
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1600px",
      "3xl": "2240px",
    },
    extend: {
      maxWidth:{page:"var(--page-max)"},
      spacing: {
        gutter:"var(--gutter)", section:"var(--section)", "float-bottom":"var(--float-bottom)",
        "drawer-offset":"var(--folder-drawer-offset)", "gallery-fit":"var(--gallery-fit-height)", "safe-top":"var(--safe-top)",
        rail: "var(--nav-width)",
        "rail-compact": "var(--nav-width-compact)",
        topbar: "var(--topbar-h)",
        tabbar: "var(--tabbar-height)",
      },
      zIndex: Object.fromEntries(
        [
          "rail",
          "topbar",
          "toolbar",
          "floatingbar",
          "tabbar",
          "popover",
          "sheet",
          "dialog",
          "viewer",
          "toast",
        ].map((k) => [k, "var(--z-" + k + ")"]),
      ),
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
        page: "var(--dur-page)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        spring: "var(--ease-spring)",
        exit: "var(--ease-exit)",
      },
      colors: Object.fromEntries(
        [
          ...COLOR_ROLES,
          "scrim",
          "theater-glass",
          "theater-danger",
          "theater-warning",
          "theater-success",
          "theater-favorite",
        ].map((name) => [name, tokenColor(name)]),
      ),
      borderRadius: {
        DEFAULT: "var(--r-sm)",
        tile: "var(--r-tile)",
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
        full: "var(--r-full)",
      },
      fontSize: {
        display: [
          "var(--text-display)",
          { lineHeight: "1.15", fontWeight: "600", letterSpacing: "-0.025em" },
        ],
        title: [
          "var(--text-title)",
          { lineHeight: "32px", fontWeight: "600", letterSpacing: "-0.02em" },
        ],
        heading: [
          "var(--text-heading)",
          { lineHeight: "24px", fontWeight: "600", letterSpacing: "-0.01em" },
        ],
        subheading: [
          "var(--text-subheading)",
          { lineHeight: "22px", fontWeight: "600", letterSpacing: "0em" },
        ],
        body: [
          "var(--text-body)",
          { lineHeight: "22px", fontWeight: "400", letterSpacing: "0em" },
        ],
        label: [
          "var(--text-label)",
          { lineHeight: "18px", fontWeight: "500", letterSpacing: "0em" },
        ],
        caption: [
          "var(--text-caption)",
          { lineHeight: "16px", fontWeight: "400", letterSpacing: "0.01em" },
        ],
      },
      boxShadow: {
        cover:"var(--cover-shadow)",
        1: "var(--e1)",
        2: "var(--e2)",
        3: "var(--e3)",
        canvas: "var(--canvas-shadow)",
        focus: "var(--focus-ring)",
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
  plugins: [
    plugin(({ addVariant }) => {
      addVariant("touch", "@media (hover: none), (pointer: coarse)");
      addVariant("pointer-fine", "@media (hover: hover) and (pointer: fine)");
    }),
  ],
} satisfies Config;
