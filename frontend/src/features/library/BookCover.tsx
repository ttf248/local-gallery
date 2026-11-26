export function BookCover({
  label,
  coverSeries,
  compact = false,
}: {
  label: string;
  coverSeries?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`cover-title${
        compact ? " cover-title--compact" : ""
      }${coverSeries ? " cover-title--series" : ""}`}
      data-testid="cover-title"
    >
      {coverSeries && (
        <div className="cover-title__series truncate">{coverSeries}</div>
      )}
      <div
        className={`cover-title__text ${compact ? "truncate" : "line-clamp-2"}`}
      >
        {label}
      </div>
    </div>
  );
}
