import { ImageIcon } from "../../ui/icons";
import { useState } from "react";
import { RenditionImage } from "../common";
import { VideoCoverImage } from "../common";
import type { CardData } from "./AlbumTile";

interface Props {
  data: Pick<
    CardData,
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
  const coverIndex =
    data.covers?.findIndex((path) => Boolean(path.trim())) ?? -1;
  const path = data.coverPath?.trim() || data.covers?.[coverIndex]?.trim();
  if (!path) return <CoverPlaceholder />;
  const version =
    path === data.coverPath
      ? data.coverVersion
      : data.coverVersions?.[coverIndex];
  if (data.variant === "album" && data.coverKind === "video") {
    return (
      <div className="h-full w-full bg-media">
        <VideoCoverImage
          key={path}
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
  displayWidth = 260,
}: {
  path: string;
  version?: string;
  alt: string;
  loading: "lazy" | "eager";
  position?: string;
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
      onError={() => setFailed(true)}
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
