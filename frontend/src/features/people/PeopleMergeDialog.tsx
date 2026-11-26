import { Dialog } from "../../ui/Dialog";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { aiJobsApi, type PersonGroup } from "../../api/aiJobs";

interface Props {
  personId: string;
  onClose: () => void;
  onMerge: (targetId: string) => void;
  isMerging: boolean;
}

export default function PeopleMergeDialog({
  personId,
  onClose,
  onMerge,
  isMerging,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const result = useQuery({
    queryKey: ["people-search", debouncedQuery],
    queryFn: () => aiJobsApi.searchPeople(debouncedQuery),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const candidates = (result.data?.people ?? []).filter(
    (person) => person.id !== personId,
  );
  const selected = candidates.find((person) => person.id === targetId);

  return (
    <Dialog
      open
      title="合并到另一个人物"
      onClose={onClose}
      initialFocus={inputRef}
    >
      <div className="flex max-h-[76dvh] flex-col">
        <div className="space-y-3 px-5 py-4">
          <label
            className="block text-caption text-ink-2"
            htmlFor="people-merge-search"
          >
            搜索人物名称或编号后六位
          </label>
          <input
            ref={inputRef}
            id="people-merge-search"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-body text-ink outline-none focus:border-line-strong"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setTargetId("");
            }}
            placeholder="例如：家人、7f873d"
            autoComplete="off"
          />
          <div className="flex items-center justify-between text-caption text-ink-3">
            <span>
              {result.isPending
                ? "正在查找…"
                : result.data
                  ? query.trim()
                    ? `匹配 ${result.data.totalGroups.toLocaleString()} 组`
                    : `按照片数排序 · 显示前 ${candidates.length} 组`
                  : ""}
            </span>
            {selected ? <span>已选择：{selected.name}</span> : null}
          </div>
          {result.isError ? (
            <p role="alert" className="text-caption text-danger">
              人物查找失败，请稍后重试。
            </p>
          ) : null}
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto border-y border-line px-3 py-2">
          {candidates.map((person: PersonGroup) => (
            <li key={person.id}>
              <button
                type="button"
                aria-pressed={targetId === person.id}
                onClick={() => setTargetId(person.id)}
                className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors ${
                  targetId === person.id
                    ? "bg-sunken text-ink"
                    : "text-ink-2 hover:bg-sunken hover:text-ink"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">
                    {person.name}
                  </span>
                  <span className="mt-0.5 block text-caption text-ink-3">
                    {person.photoCount.toLocaleString()} 张照片 ·{" "}
                    {person.faceCount.toLocaleString()} 张脸
                  </span>
                </span>
                <span className="shrink-0 text-caption text-ink-3">
                  {targetId === person.id ? "已选择" : "选择"}
                </span>
              </button>
            </li>
          ))}
          {!result.isPending && !result.isError && candidates.length === 0 ? (
            <li className="px-3 py-8 text-center text-caption text-ink-2">
              {query.trim() ? "没有匹配的人物" : "暂时没有可合并的人物"}
            </li>
          ) : null}
        </ul>
        <footer className="flex items-center justify-between gap-3 px-5 py-4">
          <p className="max-w-[55%] text-caption text-ink-3">
            合并后会把当前组的人脸移动到目标组。
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!targetId || isMerging}
            onClick={() => onMerge(targetId)}
          >
            {isMerging ? "合并中…" : "确认合并"}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
