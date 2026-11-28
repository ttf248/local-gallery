import { execFileSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [version, os, arch, output = "artifacts", flag] = process.argv.slice(2);
const targets = ["windows-amd64", "linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64"];
if (!/^2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || !targets.includes(`${os}-${arch}`) || (flag && flag !== "--skip-frontend")) {
  throw new Error("用法：node scripts/package-release.mjs 2.0.0 windows amd64 [输出目录] [--skip-frontend]");
}
const windows = os === "windows";
if (windows && (process.platform !== "win32" || process.arch !== "x64")) {
  throw new Error("Windows 便携包需要在 Windows x64 主机打包和验证。");
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

if (flag !== "--skip-frontend") {
  const frontend = { cwd: join(root, "frontend"), env: { ...process.env, LOCAL_GALLERY_VERSION: version } };
  if (process.platform === "win32") run("cmd.exe", ["/d", "/c", "npm run build"], frontend);
  else run("npm", ["run", "build"], frontend);
}
const dist = join(root, "frontend", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("缺少前端构建产物。");

const destination = resolve(output);
mkdirSync(destination, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "local-gallery-package-"));
const name = `local-gallery-v${version}-${os}-${arch}${windows ? "-portable" : ""}`;
const bundle = join(work, name);
const archive = join(destination, `${name}.${windows ? "zip" : "tar.gz"}`);
const partial = `${archive}.tmp`;
try {
  mkdirSync(bundle);
  run("go", ["build", "-trimpath", "-ldflags", `-X github.com/tianlongxiang/local-gallery/internal/config.Version=${version}`, "-o", join(bundle, windows ? "local-gallery.exe" : "local-gallery"), "./cmd/server"], {
    cwd: join(root, "backend"),
    env: { ...process.env, CGO_ENABLED: "0", GOOS: os, GOARCH: arch },
  });
  cpSync(dist, join(bundle, "dist"), { recursive: true, filter: (file) => !file.endsWith(".map") });
  mkdirSync(join(bundle, "backend"));
  cpSync(join(root, "backend", "config.example.yaml"), join(bundle, "backend", "config.example.yaml"));
  cpSync(join(root, "backend", "config.example.yaml"), join(bundle, "config.example.yaml"));
  for (const file of ["README.md", "AGENTS.md", "docs", "LICENSE"]) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(bundle, file), { recursive: true });
  }
  const worker = join(root, "backend", "aiworker");
  mkdirSync(join(bundle, "aiworker"));
  for (const file of readdirSync(worker).filter((path) => /\.(py|txt|bat|json)$/.test(path))) {
    cpSync(join(worker, file), join(bundle, "aiworker", file));
  }
  if (windows) {
    run("python", [join(root, "scripts", "windows-portable", "bundle.py"), bundle, work]);
    run("tar.exe", ["--format", "zip", "-cf", partial, "-C", work, name]);
  } else {
    run("tar", ["-czf", partial, "-C", work, name]);
  }
  if (statSync(partial).size >= 2 ** 31) throw new Error("GitHub 发布文件必须小于 2 GiB。");
  renameSync(partial, archive);
  console.log(`发布包已生成：${basename(archive)}`);
} finally {
  rmSync(partial, { force: true });
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
