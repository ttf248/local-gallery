import { expect, test } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureLibraryReady, liveRoots, solidPng } from "./helpers/library";

/**
 * 目录监听与增量扫描的端到端验证。
 *
 * 判据是「图库真的更新了」，不是「收到了文件事件」：新增的相册必须
 * 自己出现在媒体库索引里，删掉之后又必须自己消失。
 */
test("媒体文件新增后图库自动更新，删除后自动移除", async ({ request }) => {
  // 临时库里有一个故意离线的根；先摘掉它，图库才能建立起来。
  const mediaRoots = await liveRoots(request);
  const photoRoot = mediaRoots.find((root) => root.kind === "photo");
  expect(photoRoot, "照片根目录缺失").toBeTruthy();
  await ensureLibraryReady(request);

  const status = await request.get("/api/library-sync");
  expect(status.ok()).toBeTruthy();
  const sync = (await status.json()) as {
    enabled: boolean;
    running: boolean;
  };
  expect(sync.enabled, "默认应当打开自动发现文件变化").toBe(true);
  expect(sync.running, "监听应当已经在跑").toBe(true);

  const albumName = "auto-sync-album";
  const album = path.join(photoRoot!.path, albumName);
  const file = path.join(album, "page.png");

  const albumNames = async (): Promise<string[]> => {
    const response = await request.get("/api/library/manifest");
    if (!response.ok()) return [];
    const body = (await response.json()) as {
      manifest: { roots: { id: string; contentKind: string }[] };
    };
    const root = body.manifest.roots.find((item) => item.contentKind === "photo");
    if (!root) return [];
    const children = await request.get(
      `/api/library/${root.id}/children?limit=300&kind=photo`,
    );
    if (!children.ok()) return [];
    const page = (await children.json()) as { page: { items: { name: string }[] } };
    return page.page.items.map((item) => item.name);
  };

  try {
    expect(await albumNames()).not.toContain(albumName);

    mkdirSync(album, { recursive: true });
    writeFileSync(file, solidPng(64, 64));

    // 新相册自己出现在索引里：不需要点扫描，也不需要刷新页面。
    await expect
      .poll(async () => (await albumNames()).includes(albumName), {
        timeout: 30_000,
        intervals: [500],
      })
      .toBe(true);
  } finally {
    rmSync(album, { recursive: true, force: true });
  }

  // 删掉之后索引里也不能留着它。
  await expect
    .poll(async () => (await albumNames()).includes(albumName), {
      timeout: 30_000,
      intervals: [500],
    })
    .toBe(false);
});
