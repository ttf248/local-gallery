import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { usePageChrome } from "../../shell/PageChrome";
import { SearchField } from "../../ui/SearchField";
import Segmented from "../../ui/Segmented";
import type { SearchScope } from "../../utils/searchScope";

interface Props {
  title: string;
  backTo?: string;
  query?: string;
  scope: SearchScope;
  photo: boolean;
  onScopeChange: (scope: SearchScope, draft: string) => void;
  onSubmit: (query: string) => void;
  onClear?: () => void;
}

export function SearchToolbar({
  title,
  backTo,
  query = "",
  scope,
  photo,
  onScopeChange,
  onSubmit,
  onClear,
}: Props) {
  const [draft, setDraft] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  const { key } = useLocation();
  const inlineScope = useMediaQuery("(min-width: 640px)");
  useEffect(() => setDraft(query), [query, key]);

  const scopeControl = photo && (
    <Segmented
      label="搜索范围"
      size="sm"
      value={scope}
      onChange={(next) => onScopeChange(next, draft.trim())}
      options={[
        { value: "name", label: "名称" },
        { value: "content", label: "画面与文字" },
      ]}
    />
  );
  function submit(value: string) {
    const keyword = value.trim();
    setDraft(keyword);
    if (window.matchMedia?.("(pointer: coarse)").matches) {
      input.current?.blur();
    }
    if (keyword) onSubmit(keyword);
    else onClear?.();
  }
  usePageChrome({
    title,
    backTo,
    search: (
      <div className="flex w-full min-w-0 max-w-[760px] items-center gap-3">
        <SearchField
          ref={input}
          className="min-w-0 flex-1"
          aria-label="搜索"
          enterKeyHint="search"
          placeholder={
            photo
              ? scope === "name"
                ? "搜索相册、文件夹或标签"
                : "搜索照片里的画面与文字"
              : "搜索作品与标签"
          }
          maxLength={200}
          value={draft}
          onValueChange={(value) => {
            setDraft(value);
            if (!value) onClear?.();
          }}
          onSubmit={submit}
          trailing={
            draft && (
              <button
                type="button"
                aria-label="提交搜索"
                className="size-8 rounded-md hover:bg-hover touch:size-10"
                onClick={() => submit(draft)}
              >
                ↵
              </button>
            )
          }
        />
        {inlineScope && scopeControl}
      </div>
    ),
  });

  return !inlineScope && photo ? (
    <div className="flex shrink-0 items-center justify-between gap-2 py-1">
      <span aria-hidden="true" className="text-label font-medium">
        {title}
      </span>
      {scopeControl}
    </div>
  ) : null;
}
