import { useState } from "react";
import RenditionImage from "../common/RenditionImage";
import VideoCoverImage from "../common/VideoCoverImage";
import { FolderIcon } from "../../ui/icons";
import type { CardData } from "./AlbumCard";

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

interface CoverSource {
  path: string;
  version?: string;
}

export type EditorialCollageLayout =
  "empty" | "single" | "split-2" | "feature-3" | "grid-4";

// eslint-disable-next-line react-refresh/only-export-components
export function resolveCollageLayout(count: number): EditorialCollageLayout {
  if (count <= 0) return "empty";
  if (count === 1) return "single";
  if (count === 2) return "split-2";
  if (count === 3) return "feature-3";
  return "grid-4";
}

export default function CardCover({
  data,
  loading = "lazy",
  compact = false,
}: Props) {
  const sources = getCoverSources(data);
  const primary = sources[0];
  if (!primary) return <CoverPlaceholder />;

  if (data.variant === "album" && data.coverKind === "video") {
    return (
      <div className="h-full w-full bg-bg-media">
        <VideoCoverImage
          key={primary.path}
          videoPath={primary.path}
          version={primary.version}
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

  if (data.variant === "album" || compact) {
    return (
      <CoverImage
        key={primary.path}
        path={primary.path}
        version={primary.version}
        alt={data.title}
        loading={loading}
        displayWidth={compact ? 48 : 260}
        position={data.variant === "album" ? "50% 25%" : undefined}
      />
    );
  }

  const layout = resolveCollageLayout(sources.length);
  return (
    <div
      className="editorial-collage"
      data-cover-layout={layout}
      data-testid="card-cover-collage"
    >
      {sources.map((source, index) => (
        <div key={source.path} className="editorial-collage__cell">
          <CoverImage
            path={source.path}
            version={source.version}
            alt={index === 0 ? data.title : ""}
            loading={loading}
            displayWidth={
              layout === "single"
                ? 260
                : layout === "feature-3" && index === 0
                  ? 180
                  : 130
            }
          />
        </div>
      ))}
    </div>
  );
}

/**
 * 封面来源与它们的版本号。
 *
 * 版本号跟着图一起取：去重之后下标会变，按下标去取版本号会取错 ——
 * 同一张图配着另一张的版本，封面就会显示成旧的那一张。
 */
function getCoverSources(
  data: Pick<
    CardData,
    "coverPath" | "coverVersion" | "covers" | "coverVersions" | "variant"
  >,
): CoverSource[] {
  if (data.variant === "album") {
    return data.coverPath
      ? [{ path: data.coverPath, version: data.coverVersion }]
      : [];
  }

  const seen = new Set<string>();
  const list: CoverSource[] = [];
  const covers = data.covers ?? [];
  for (let index = 0; index < covers.length && list.length < 4; index += 1) {
    const path = covers[index].trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    list.push({ path, version: data.coverVersions?.[index] });
  }

  if (list.length > 0) return list;
  return data.coverPath
    ? [{ path: data.coverPath, version: data.coverVersion }]
    : [];
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
    return <div className="h-full w-full bg-bg-strong" aria-hidden="true" />;

  return (
    <RenditionImage
      fileId={path}
      version={version}
      alt={alt}
      displayWidth={displayWidth}
      loading={loading}
      onError={() => setFailed(true)}
      style={{ objectPosition: position }}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] group-active:scale-[1.03]"
    />
  );
}

function CoverPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-bg-subtle text-fg-subtle">
      <FolderIcon size={28} />
    </div>
  );
}
