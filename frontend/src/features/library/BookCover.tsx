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
      className={`cover-title absolute inset-x-0 bottom-0 z-[2] [padding:22px_11px_9px] [background-image:linear-gradient(to_top,var(--cover-band)_0%,var(--cover-band)_70%,color-mix(in_srgb,var(--cover-band)_57%,transparent)_88%,transparent_100%)] pointer-events-none${
        compact ? " cover-title--compact [padding:20px_10px_8px]" : ""
      }${coverSeries ? " cover-title--series pt-[30px] [background-image:linear-gradient(to_top,var(--cover-band)_0%,var(--cover-band)_70%,color-mix(in_srgb,var(--cover-band)_57%,transparent)_88%,transparent_100%)]" : ""}`}
      data-testid="cover-title"
    >
      {coverSeries && (
        <div className="cover-title__series [color:rgb(255_255_255_/_0.78)] text-micro font-medium leading-[1.2] tracking-[0.06em] mb-[3px] [text-shadow:0_1px_3px_rgb(0_0_0_/_0.55)] truncate">{coverSeries}</div>
      )}
      <div
        className={`cover-title__text text-overlay-fg text-body font-semibold leading-[1.24] tracking-[0.01em] [text-shadow:0_1px_3px_rgb(0_0_0_/_0.5)] [.cover-title--compact_&]:text-body [.cover-title--compact_&]:leading-[1.3] ${compact ? "truncate" : "line-clamp-2"}`}
      >
        {label}
      </div>
    </div>
  );
}
