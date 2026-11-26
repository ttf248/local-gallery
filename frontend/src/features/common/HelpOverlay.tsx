import { useEffect, useRef, useState } from "react";
import {
  SHORTCUTS,
  type Shortcut,
  type ShortcutContext,
} from "../../utils/shortcutsTable";
import { useAppMode } from "../../hooks/useAppMode";
import { Dialog } from "../../ui/Dialog";
import { SearchField } from "../../ui/SearchField";
import { Kbd } from "../../ui/Kbd";

interface Props {
  open: boolean;
  onClose: () => void;
  context: ShortcutContext;
  /**
   * 配色档：
   *   theme  —— 跟随应用主题（页面内的普通快捷键面板）
   *   reader —— 阅读器暗场。阅读器画布恒为深色，浅色卡片浮在上面就像
   *              "黑底里嵌了一块白板"；信息面板已经是暗的，菜单再是
   *              浅的，两块浮层自己就打架。
   */
  tone?: "theme" | "reader";
}

// 按当前页面显示全局操作，或阅读器共用操作及对应媒体操作。
const GROUP_ORDER: Array<{
  key: Shortcut["group"];
  title: string;
}> = [
  { key: "global", title: "全局" },
  { key: "photo", title: "照片墙" },
  { key: "reader", title: "阅读器" },
  { key: "image", title: "图片" },
  { key: "video", title: "视频" },
];

// 帮助浮层：可搜索的快捷键列表 + 分类。
// 视觉上：更大留白，单列紧凑列表；搜索框即时过滤。
//
// 数据源：直接消费 SHORTCUTS（按 group 字段分组）。新增/删除快捷键时，
// 只需修改 shortcuts.ts，HelpOverlay 自动同步。
export default function HelpOverlay({
  open,
  onClose,
  context,
  tone = "theme",
}: Props) {
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const dark = tone === "reader";
  // 少数全局操作的措辞随工作台模式变化（照片工作台讲「未浏览」）。
  const { mode } = useAppMode();

  const describe = (s: Shortcut) => s.modeDescriptions?.[mode] ?? s.description;

  // 只在某个工作台模式下存在的快捷键，在另一个模式下不列出：
  // 未读页属于漫画，照片模式下按 U 什么也不会发生。
  const inCurrentMode = (s: Shortcut) => !s.modes || s.modes.includes(mode);

  useEffect(() => {
    if (!open) {
      setQ("");
      setSection("");
    }
  }, [open]);
  const lc = q.trim().toLowerCase();

  if (!open) return null;

  const matches = (s: Shortcut) => {
    if (!lc) return true;
    return (
      s.id.toLowerCase().includes(lc) ||
      describe(s).toLowerCase().includes(lc) ||
      s.label.toLowerCase().includes(lc)
    );
  };

  // 按 group 字段分组，渲染顺序由 GROUP_ORDER 决定
  // 照片墙是主页面的一种形态：全局操作照旧，再多一组大图预览的操作。
  const activeGroups: Shortcut["group"][] =
    context === "library"
      ? ["global"]
      : context === "photo"
        ? ["global", "photo"]
        : ["reader", context];
  const filteredGroups = GROUP_ORDER.filter((g) => activeGroups.includes(g.key))
    .map((g) => ({
      title: g.title,
      items: SHORTCUTS.filter(
        (s) => s.group === g.key && matches(s) && inCurrentMode(s),
      ),
    }))
    .filter((g) => g.items.length > 0);

  const total = filteredGroups.reduce((s, g) => s + g.items.length, 0);

  return (
    <Dialog
      title="快捷键"
      size="lg"
      open={open}
      onClose={onClose}
      initialFocus={searchRef}
      data-tone={dark ? "reader" : undefined}
      tone={dark ? "reader" : "theme"}
    >
      <SearchField
        ref={searchRef}
        aria-label="搜索快捷键"
        placeholder="搜索快捷键…"
        value={q}
        onValueChange={(value) => {
          setQ(value);
          setSection("");
        }}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-[128px_minmax(0,1fr)]">
        <nav
          aria-label="快捷键分类"
          className="flex flex-wrap content-start gap-1 sm:flex-col"
        >
          {filteredGroups.map((group) => (
            <button
              key={group.title}
              className="min-h-9 rounded-md px-3 text-left text-label aria-pressed:bg-sunken aria-pressed:text-ink"
              aria-pressed={section === group.title}
              onClick={() =>
                setSection(section === group.title ? "" : group.title)
              }
            >
              {group.title}
            </button>
          ))}
        </nav>
        <div className="max-h-[55dvh] overflow-y-auto">
          {total === 0 && (
            <p className="py-6 text-ink-2">没有匹配「{q}」的快捷键</p>
          )}
          {filteredGroups
            .filter((group) => !section || group.title === section)
            .map((group) => (
              <ul
                key={group.title}
                aria-label={group.title}
                className="mb-5 grid gap-x-6 gap-y-2 md:grid-cols-2"
              >
                {group.items.map((shortcut) => (
                  <li
                    key={shortcut.id}
                    className="flex items-center justify-between gap-2 text-label"
                  >
                    <span>{describe(shortcut)}</span>
                    <Kbd keys={[shortcut.label]} />
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </Dialog>
  );
}
