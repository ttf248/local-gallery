import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const forbidden =
  /#[\da-f]{3,8}\b|(?<![\w-])(?:btn(?:-[\w-]+)?|chip|ui-chip|page-shell|segments|ui-segmented|toolbar-icon|field-frame|hover-reveal)(?![\w-])|text-\[\d+px\]|(?:bg-bg(?:-[\w-]+)?|text-fg(?:-[\w-]+)?|[\w-]+-signal(?:-[\w-]+)?)\b|window\.confirm\s*\(/i;
const arbitraryToken = /\[var\(--/;
const root = path.resolve(__dirname, "..");
function violations(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return violations(file);
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx"))
      return [];
    const name = path.relative(root, file).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    return forbidden.test(source) ||
      (/^(features|routes)\//.test(name) && arbitraryToken.test(source))
      ? [name]
      : [];
  });
}

// 已登记的旧页面随对应阶段迁移。新文件或已迁移文件重新使用旧样式会使断言失败。
const remaining = [
  "features/album/AlbumFilterBar.tsx",
  "features/album/AlbumFilterPanel.tsx",
  "features/album/AlbumGroupPanel.tsx",
  "features/album/AlbumHeader.tsx",
  "features/album/CollectionPhotoBand.tsx",
  "features/collection/PickShowcase.tsx",
  "features/comic/ContinueReadingHero.tsx",
  "features/comic/SmartAlbumPreview.tsx",
  "features/common/ErrorBanner.tsx",
  "features/common/FilterDropdown.tsx",
  "features/common/HoverPreview.tsx",
  "features/common/LibrarySelectionActions.tsx",
  "features/common/ListFilterBar.tsx",
  "features/common/ListPagination.tsx",
  "features/common/ScanWarnings.tsx",
  "features/common/VideoCoverImage.tsx",
  "features/common/ViewedSortNotice.tsx",
  "features/explore/ExploreSection.tsx",
  "features/explore/YearRibbon.tsx",
  "features/library/AlbumCardParts.tsx",
  "features/library/AlbumGridSkeleton.tsx",
  "features/library/AlbumListRow.tsx",
  "features/library/AlbumTile.tsx",
  "features/library/BreadcrumbMenu.tsx",
  "features/library/FolderDrawer.tsx",
  "features/library/FolderTree.tsx",
  "features/people/PeopleMergeDialog.tsx",
  "features/reader/GalleryAlbumNav.tsx",
  "features/reader/ImageGallery.tsx",
  "features/search/ContentSearchResults.tsx",
  "features/settings/DirectoryPicker.tsx",
  "features/settings/StateBackupPanel.tsx",
  "features/similarity/SimilarityGroupCard.tsx",
  "features/tasks/CacheRebuildPanel.tsx",
  "features/tasks/DailyPlanPanel.tsx",
  "features/tasks/JobHistoryPanel.tsx",
  "features/tasks/SmartAlbumRefreshPanel.tsx",
  "features/tasks/StorageUsage.tsx",
  "features/tasks/TaskConsole.tsx",
  "features/tasks/TaskEstimatePanel.tsx",
  "features/tasks/TaskQueuePanel.tsx",
  "features/tasks/TaskSummary.tsx",
  "features/timeline/TimelineFilterPopover.tsx",
  "features/travels/TravelMap.tsx",
  "features/travels/TravelStats.tsx",
  "features/travels/TravelTimeAxis.tsx",
  "features/viewer/ImageInfoPanel.tsx",
  "features/wall/DensityControl.tsx",
  "features/wall/MediaTile.tsx",
  "features/wall/PhotoMasonry.tsx",
  "features/wall/PhotoStrip.tsx",
  "features/wall/PhotoWall.tsx",
  "routes/Album.tsx",
  "routes/Explore.tsx",
  "routes/Favorites.tsx",
  "routes/Home.tsx",
  "routes/Library.tsx",
  "routes/Me.tsx",
  "routes/People.tsx",
  "routes/PeopleAnnotate.tsx",
  "routes/PhotoAlbum.tsx",
  "routes/PhotoTimeline.tsx",
  "routes/Picks.tsx",
  "routes/RandomPhotos.tsx",
  "routes/Reader.tsx",
  "routes/Recents.tsx",
  "routes/SearchResults.tsx",
  "routes/SemanticSearch.tsx",
  "routes/Settings.tsx",
  "routes/Similarity.tsx",
  "routes/SmartAlbums.tsx",
  "routes/Tag.tsx",
  "routes/TaskCenter.tsx",
  "routes/TravelPlace.tsx",
  "routes/Travels.tsx",
  "routes/Unread.tsx",
  "routes/YearPhotos.tsx",
];
it("待迁移文件只能随阶段减少", () => {
  expect(violations(root).sort()).toEqual([...remaining].sort());
});
