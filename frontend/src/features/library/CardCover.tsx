import { ImageIcon } from "../../ui/icons";
import { useState } from "react";
import { RenditionImage } from "../common";
import { VideoCoverImage } from "../common";
import type { CardData } from "./AlbumTile";

interface Props {
  data: Pick<
    CardData,
    | "candidates"
    | "coverKind"
    | "coverPath"
    | "covers"
    | "coverVersion"
    | "coverVersions"
    | "title"
    | "variant"
    | "contentKind"
  >;
  loading?: "lazy" | "eager";
  compact?: boolean;
}

export default function CardCover({
  data,
  loading = "lazy",
  compact = false,
}: Props) {
  const [failedIDs, setFailedIDs] = useState<string[]>([]);
  const token = (c: { id: string; version: string }) => c.id + "/" + c.version;
  const selected = data.candidates?.find((c) => !failedIDs.includes(token(c)));
  const advance = selected
    ? () =>
        setFailedIDs((ids) =>
          ids.includes(token(selected)) ? ids : [...ids, token(selected)],
        )
    : undefined;
  if (data.candidates && !selected) return <CoverPlaceholder />;
  const coverIndex =
    data.covers?.findIndex((path) => Boolean(path.trim())) ?? -1;
  const path =
    selected?.id ??
    (data.coverPath?.trim() || data.covers?.[coverIndex]?.trim());
  if (!path) return <CoverPlaceholder />;
  const version =
    selected?.version ??
    (path === data.coverPath
      ? data.coverVersion
      : data.coverVersions?.[coverIndex]);
  if (
    selected?.kind === "video" ||
    (!selected && data.variant === "album" && data.coverKind === "video")
  ) {
    return (
      <div className="h-full w-full bg-media">
        <VideoCoverImage
          key={path}
          onFailure={advance}
          videoPath={path}
          version={version}
          displayWidth={compact ? 48 : 260}
          loading={loading}
          alt={data.title}
          showRetryAction={false}
          showExtractingHint={!compact}
          fit="cover"
        />
      </div>
    );
  }

  return (
    <CoverImage
      key={path}
      onFailure={advance}
      path={path}
      version={version}
      alt={data.title}
      loading={loading}
      displayWidth={compact ? 48 : 300}
      position={data.variant === "album" ? "50% 25%" : undefined}
    />
  );
}

function CoverImage({
  path,
  version,
  alt,
  loading,
  position = "50% 50%",
  onFailure,
  displayWidth = 260,
}: {
  path: string;
  version?: string;
  alt: string;
  loading: "lazy" | "eager";
  position?: string;
  onFailure?: () => void;
  displayWidth?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed)
    return (
      <div
        className="grid h-full w-full place-items-center bg-media text-ink-3"
        role="img"
        aria-label={alt + "（封面不可用）"}
      >
        <ImageIcon size={24} />
      </div>
    );

  return (
    <RenditionImage
      fileId={path}
      version={version}
      alt={alt}
      displayWidth={displayWidth}
      loading={loading}
      onError={onFailure ?? (() => setFailed(true))}
      style={{ objectPosition: position }}
      className="w-full h-full object-cover transition-transform duration-slow motion-safe:group-hover:scale-[1.03] motion-safe:group-active:scale-[1.03]"
    />
  );
}

function CoverPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-media text-ink-3">
      <ImageIcon size={24} />
    </div>
  );
}
