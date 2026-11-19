import { useRef, type ReactNode } from "react";
import type { PageTabDef } from "../../utils/pageTabs";

interface Props {
  tabs: PageTabDef[];
  /** 当前页签的 id。 */
  active: string;
  onChange: (id: string) => void;
  /** 无障碍名称，例如「设置页分区」。 */
  label: string;
  /** dom id 前缀（`settings` / `tasks`）：页签与面板的 id 靠它配对。 */
  idPrefix: string;
  /** 右侧的一句补充：这一屏在做什么。 */
  meta?: ReactNode;
}

/**
 * 页面内页签条。
 *
 * 它是这一页自己的分区开关，不是第二条菜单轴：贴在页头下面，选中项
 * 有一条下划线，面板用 `role="tabpanel"` 与它关联 —— 读屏与键盘都知道
 * 「这一页分几段、现在在哪一段」。
 *
 * 方向键在页签条内切换（照分段控件的规矩），但不注册成全局快捷键 ——
 * 全局单键已经被占满，页签切换是页面内的操作。
 */
export default function PageTabs({
  tabs,
  active,
  onChange,
  label,
  idPrefix,
  meta,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  function focusTab(id: string) {
    const button = ref.current?.querySelector<HTMLButtonElement>(
      `[id="${idPrefix}-tab-${id}"]`,
    );
    button?.focus();
  }

  function move(step: number) {
    const index = tabs.findIndex((tab) => tab.id === active);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.id);
    focusTab(next.id);
  }

  return (
    <div ref={ref} role="tablist" aria-label={label} className="page-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          // 漫游 tabindex：只有当前页签在 Tab 序列里，其余用方向键到达。
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              const first = tabs[0];
              if (!first) return;
              onChange(first.id);
              focusTab(first.id);
            } else if (event.key === "End") {
              event.preventDefault();
              const last = tabs[tabs.length - 1];
              if (!last) return;
              onChange(last.id);
              focusTab(last.id);
            }
          }}
          className="page-tabs__tab"
        >
          {tab.label}
        </button>
      ))}
      {meta ? <span className="page-tabs__meta">{meta}</span> : null}
    </div>
  );
}

/**
 * 页签面板。
 *
 * `hidden` 而不是卸载：面板里的草稿与筛选是组件内状态（服务端配置的路径
 * 草稿、任务记录的筛选、备份的预览），看一眼别的页签就卸载掉等于把用户
 * 刚填的东西扔了。没访问过的页签不挂载 —— 首次进页面不渲染历史列表。
 */
export function PagePanel({
  idPrefix,
  tab,
  active,
  className,
  children,
}: {
  idPrefix: string;
  tab: PageTabDef;
  active: string;
  /** 面板自己的版面类：页面需要它撑满剩余高度时用。 */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tab.id}`}
      aria-labelledby={`${idPrefix}-tab-${tab.id}`}
      hidden={tab.id !== active}
      className={className}
    >
      {children}
    </div>
  );
}
