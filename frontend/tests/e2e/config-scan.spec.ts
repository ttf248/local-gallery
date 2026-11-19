import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MediaRootConfig } from "./helpers/library";

test("保存媒体根后自动扫描，等价配置不重扫", async ({ page, request }) => {
  const original = (await (await request.get("/api/config")).json()) as {
    mediaRoots: MediaRootConfig[];
  };
  const live = original.mediaRoots.filter((root) => existsSync(root.path));
  expect(live.length).toBeGreaterThan(0);
  const root = path.join(path.dirname(live[0]!.path), "auto-scan-media");
  const album = path.join(root, "automatic-album");
  mkdirSync(album, { recursive: true });
  writeFileSync(
    path.join(album, "page.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const starts: string[] = [];
  page.on("request", (req) => {
    if (
      new URL(req.url()).pathname === "/api/scans" &&
      req.method() === "POST"
    ) {
      starts.push(req.url());
    }
  });
  try {
    await request.put("/api/config", { data: { mediaRoots: live } });
    await page.goto("/settings/server");
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/config" &&
        response.request().method() === "PUT",
    );
    await page
      .getByRole("textbox", { name: "媒体根目录 1", exact: true })
      .fill(root);
    await page
      .getByRole("textbox", { name: "媒体根目录 1", exact: true })
      .press("Enter");
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    const result = (await response.json()) as {
      scanId?: string;
      mediaRootsChanged: boolean;
    };
    expect(result.mediaRootsChanged).toBe(true);
    expect(result.scanId).toBeTruthy();

    await expect
      .poll(
        async () => {
          const manifestResponse = await request.get("/api/library/manifest");
          if (!manifestResponse.ok()) return false;
          const manifest = (await manifestResponse.json()) as {
            manifest: { roots: Array<{ id: string; name: string }> };
          };
          const newRoot = manifest.manifest.roots.find(
            (item) => item.name === path.basename(root),
          );
          if (!newRoot) return false;
          const childrenResponse = await request.get(
            `/api/library/${encodeURIComponent(newRoot.id)}/children?limit=50&kind=photo`,
          );
          if (!childrenResponse.ok()) return false;
          const children = (await childrenResponse.json()) as {
            page: { items: Array<{ kind: string; name: string }> };
          };
          return children.page.items.some(
            (item) => item.kind === "album" && item.name === "automatic-album",
          );
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    expect(starts).toHaveLength(0);

    const confirmed = (await (await request.get("/api/config")).json()) as {
      mediaRoots: MediaRootConfig[];
    };
    const same = await request.put("/api/config", {
      data: { mediaRoots: [...confirmed.mediaRoots].reverse() },
    });
    const unchanged = (await same.json()) as {
      mediaRootsChanged: boolean;
      scanId?: string;
    };
    expect(unchanged.mediaRootsChanged).toBe(false);
    expect(unchanged.scanId).toBeUndefined();
    mkdirSync(".smoke/roadmap-auto-scan", { recursive: true });
    await page.screenshot({
      path: ".smoke/roadmap-auto-scan/settings.png",
      fullPage: true,
    });
  } finally {
    await request.put("/api/config", { data: { mediaRoots: live } });
  }
});
