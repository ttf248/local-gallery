import type { LibraryNodeSummary, LibraryTagSummary } from "../api/library";
import type { CardData } from "../components/album/AlbumCard";
import { albumRoute, tagRoute } from "./path";

export function nodeSummaryToCard(
  node: LibraryNodeSummary,
  idPrefix = node.kind === "album" ? "a:" : "c:",
): CardData {
  const isAlbum = node.kind === "album";
  return {
    id: idPrefix + node.id,
    variant: node.kind,
    title: node.name,
    displayTitle: node.displayName,
    subtitle: isAlbum ? node.author || undefined : "集合",
    count: isAlbum ? (node.imageCount ?? 0) : (node.albumCount ?? 0),
    imageCount: isAlbum ? (node.imageCount ?? 0) : undefined,
    videoCount: isAlbum ? (node.videoCount ?? 0) : undefined,
    coverPath: node.coverImage ?? "",
    covers: node.coverImages,
    coverKind: node.coverKind,
    to: albumRoute(node.id),
    sourceRoot: node.sourceRoot,
    sourceName: node.sourceName,
  };
}

export function tagSummaryToCard(tag: LibraryTagSummary): CardData {
  return {
    id: "s:" + tag.tag,
    variant: "smart",
    title: tag.tag,
    count: tag.albumCount,
    coverPath: tag.coverImage ?? "",
    covers: tag.coverImages,
    to: tagRoute(tag.tag),
  };
}
