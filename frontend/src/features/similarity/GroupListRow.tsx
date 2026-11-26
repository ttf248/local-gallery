import type { SimilarityGroup } from "../../api/similarity";
import {
  similarityKindLabel,
  similarityStatusLabel,
} from "../../hooks/useSimilarity";
import { ThumbImage } from "../common";
import { Badge } from "../../ui/Badge";

export function GroupListRow({
  group,
  active,
  checked,
  onSelect,
  onCheck,
}: {
  group: SimilarityGroup;
  active: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: (range: boolean) => void;
}) {
  return (
    <div
      data-testid="similarity-group"
      data-group-id={group.id}
      data-group-status={group.status}
      className={`flex h-[72px] items-center gap-2 border-l-[3px] px-3 ${active ? "border-accent bg-selected" : "border-transparent hover:bg-hover"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        aria-label={`选中这一组（${similarityKindLabel(group.kind)}）`}
        onClick={(e) => onCheck(e.shiftKey)}
        onChange={() => {}}
        className="size-[18px] accent-accent"
      />
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <ThumbImage
          fileId={group.representative}
          alt=""
          displayWidth={56}
          className="size-14 shrink-0 rounded-md object-cover"
        />
        <span className="min-w-0">
          <span className="block truncate text-label">
            {similarityKindLabel(group.kind)} · {group.members.length} 张
          </span>
          <span
            className="block truncate text-caption text-ink-2"
            title={group.folder}
          >
            {group.folder} · 多余 {group.redundant}
          </span>
        </span>
      </button>
      {group.status !== "pending" && (
        <Badge tone={group.status === "reviewed" ? "success" : "neutral"}>
          {similarityStatusLabel(group.status)}
        </Badge>
      )}
    </div>
  );
}
