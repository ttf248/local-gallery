import { SettingsGroup } from "../../ui/SettingsList";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  configApi,
  type ServerConfig,
  type ServerConfigPatch,
} from "../../api/config";
import { useUIStore } from "../../store/uiStore";
import { updateFsCapabilities } from "../../hooks/useFsCapabilities";
import { ApiError } from "../../api/client";
import { useScanSSE } from "../../hooks/useScanSSE";
import { scanApi } from "../../api/scan";
import {
  useServerConfigSave,
  type FieldStatus,
} from "../../hooks/useServerConfigSave";
import { useAutosaveSnapshot } from "../../hooks/useAutosaveSnapshot";
import { ServerConfigField, type FieldDef } from "./ServerConfigField";
import ExcludeRulesField from "./ExcludeRulesField";
import MediaRootsField from "./MediaRootsField";
import { openConfiguredDirectory } from "./openConfiguredDirectory";
import { RefreshIcon } from "../../ui/icons";

// 哪些字段改动后需要重启才生效。
const REQUIRES_RESTART = new Set([
  "host",
  "port",
  "staticDir",
  "cacheDir",
  "ffmpegPath",
]);

// 哪些字段是路径类（用 onBlur 自动保存,不用 debounce）。
// mediaRoots 是例外:它在用户停止输入后自动保存,避免刷新页面时丢失
// 尚未失焦的修改。其余路径输入仍须按 Enter 或离开输入框确认。
//
// excludePatterns / systemFiles 同样按 onBlur 保存 — 它们虽不是路径,
// 但都是「类数组文本」(一行一项),用户经常连续粘贴多行;debounce 会
// 把多次按键当作一次输入,体感很怪,所以走 pathDirtyRef 同一条路径。
const PATH_FIELDS = new Set([
  "mediaRoots",
  "cacheDir",
  "staticDir",
  "excludePatterns",
  "systemFiles",
]);

// 媒体根目录在用户停止输入后的自动保存等待时间。不能逐字符提交：后端会
// 校验目录必须存在，输入中的不完整路径不应产生错误提示或污染当前配置。
const MEDIA_ROOTS_AUTOSAVE_DELAY = 450;

const FIELDS: { section: string; defs: FieldDef[] }[] = [
  {
    // 缓存目录与缓存开关讲的是同一件事：派生产物存在哪、留多久。
    // 之前分成「媒体库」和「缩略图」两组，「媒体库」还与上面的媒体根
    // 目录重名，两组并排时看不出谁是谁。
    section: "缓存",
    defs: [
      {
        key: "cacheDir",
        label: "缓存目录",
        hint: "存放缩略图 / 扫描结果 / 用户偏好，修改后需重启",
        kind: "text",
      },
      {
        key: "thumbCacheSize",
        label: "LRU 缓存项数",
        hint: "内存中保留多少张已生成的缩略图",
        kind: "number",
        min: 50,
        max: 5000,
      },
      {
        key: "cacheMaxAgeDays",
        label: "缓存保留天数",
        hint: "超出后被清理",
        kind: "number",
        min: 1,
        max: 365,
      },
      {
        key: "cacheMaxSizeMB",
        label: "派生缓存容量（MiB）",
        hint: "启动和每小时清理；0 不限制容量，新产物保留至少十分钟",
        kind: "number",
        min: 0,
        max: 1048576,
      },
    ],
  },
  {
    section: "网络",
    defs: [
      {
        key: "host",
        label: "监听地址",
        hint: "修改后需要重启后端",
        kind: "text",
      },
      {
        key: "port",
        label: "监听端口",
        hint: "修改后需要重启后端",
        kind: "number",
        min: 1,
        max: 65535,
      },
    ],
  },
  {
    section: "静态资源",
    defs: [
      {
        key: "staticDir",
        label: "前端构建目录",
        hint: "修改后需要重启后端",
        kind: "text",
      },
    ],
  },
  {
    section: "安全",
    defs: [
      {
        key: "allowOsOpen",
        label: "允许在系统文件管理器中打开",
        hint: "仅建议在受信环境开启",
        kind: "boolean",
      },
    ],
  },
];

// 每个 field 的当前保存状态;key 由 section+key 拼成。
type StatusMap = Record<string, FieldStatus>;

export default function ServerConfigPanel() {
  const qc = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const scanSSE = useScanSSE();

  const {
    data,
    error: queryError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["server-config"],
    queryFn: async ({ signal }) => {
      const config = await configApi.get(signal);
      if (!signal.aborted) updateFsCapabilities(qc, config.allowOsOpen);
      return config;
    },
  });

  const [status, setStatus] = useState<StatusMap>({});
  const mounted = useRef(false);
  // 每个字段独立计时；再次保存或离开面板时取消旧提示的清理任务。
  const savedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    mounted.current = true;
    const timers = savedTimers.current;
    return () => {
      mounted.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  function setFieldStatus(keys: string[], value: FieldStatus) {
    // 写请求可在卸载后完成，共享缓存仍更新，但不再创建页面状态和定时器。
    if (!mounted.current) return;
    const timers = savedTimers.current;
    keys.forEach((key) => {
      clearTimeout(timers.get(key));
      timers.delete(key);
    });
    setStatus((current) => {
      const next = { ...current };
      keys.forEach((key) => (next[key] = value));
      return next;
    });
    if (value !== "saved" && value !== "error") return;
    keys.forEach((key) => {
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          setStatus((current) =>
            current[key] === value ? { ...current, [key]: "idle" } : current,
          );
        }, 2800),
      );
    });
  }

  // 暂存用户输入:草稿,避免每次 onChange 都触发 PUT(输入体验更顺)
  const [draft, setDraft] = useState<ServerConfigPatch>({});
  const save = useServerConfigSave(draft, setFieldStatus);
  const { update, pendingValues, failedValues } = save;
  const [composingFields, setComposingFields] = useState<
    ReadonlyMap<keyof ServerConfigPatch, number>
  >(() => new Map());
  const debouncedMediaRoots = useAutosaveSnapshot(
    draft.mediaRoots,
    MEDIA_ROOTS_AUTOSAVE_DELAY,
    composingFields.has("mediaRoots") || save.isReading,
  );
  const [accessTokenDraft, setAccessTokenDraft] = useState("");
  const [accessError, setAccessError] = useState("");
  // 按字段排除仍在组合输入的候选文字，不阻塞其他字段的自动保存。
  const autosaveDraft = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(draft) as (keyof ServerConfigPatch)[])
          .filter((key) => !PATH_FIELDS.has(key) && !composingFields.has(key))
          .map((key) => [key, draft[key]]),
      ) as ServerConfigPatch,
    [draft, composingFields],
  );
  const debouncedDraft = useAutosaveSnapshot(
    autosaveDraft,
    600,
    save.isReading,
  );
  // 当前"路径类草稿"按字段拆,onBlur 时取对应字段提交
  const pathDirtyRef = useRef<
    Partial<Record<keyof ServerConfigPatch, unknown>>
  >({});
  const flushRef = useRef<(patch: ServerConfigPatch) => void>(() => {});

  // 只提交当前完整等待过保存间隔的快照，旧计时结果不能清掉新输入。
  useEffect(() => {
    if (!debouncedDraft) return;
    const keys = Object.keys(debouncedDraft) as (keyof ServerConfigPatch)[];
    if (keys.length === 0) return;
    flushRef.current(debouncedDraft);
    setDraft((current) => {
      const next = { ...current };
      keys.forEach((key) => {
        if (current[key] === debouncedDraft[key]) delete next[key];
      });
      return next;
    });
  }, [debouncedDraft]);

  function setFieldComposing(key: keyof ServerConfigPatch, active: boolean) {
    if (!mounted.current) return;
    setComposingFields((current) => {
      const previous = current.get(key) ?? 0;
      const count = Math.max(0, previous + (active ? 1 : -1));
      if (previous === count) return current;
      const next = new Map(current);
      if (count > 0) next.set(key, count);
      else next.delete(key);
      return next;
    });
  }

  function flush(patch: ServerConfigPatch) {
    update.mutate(patch);
  }
  flushRef.current = flush;

  // 媒体根目录输入后自动保存，而非等待 blur。pathDirtyRef 保存的是最近
  // 一次输入的数组引用；借此忽略已被新输入替换的过期 debounce 结果。
  useEffect(() => {
    if (debouncedMediaRoots === undefined) return;
    if (pathDirtyRef.current.mediaRoots !== debouncedMediaRoots) return;

    // "添加根目录"会先插入空输入槽位。目录尚未补全时不发无效 PATCH，
    // 待所有输入槽位都有值后再自动提交。
    if (debouncedMediaRoots.some((root) => root.path.trim() === "")) return;

    delete pathDirtyRef.current.mediaRoots;
    setDraft((current) => {
      if (current.mediaRoots !== debouncedMediaRoots) return current;
      const next = { ...current };
      delete next.mediaRoots;
      return next;
    });
    flushRef.current({ mediaRoots: debouncedMediaRoots });
  }, [debouncedMediaRoots]);

  async function enableLANAccess() {
    const token = accessTokenDraft.trim();
    if (token.length < 32 || token.length > 256 || /\s/u.test(token)) {
      setAccessError("访问令牌必须是 32-256 个无空白字符");
      return;
    }
    setAccessError("");
    try {
      await update.mutateAsync({ accessMode: "lan", accessToken: token });
      setAccessTokenDraft("");
    } catch {
      setAccessError("访问配置未完成，请确认令牌后重试");
    }
  }

  async function disableLANAccess() {
    setAccessError("");
    try {
      await update.mutateAsync({ accessMode: "local", accessToken: "" });
      setAccessTokenDraft("");
    } catch {
      setAccessError("无法切换为仅本机访问");
    }
  }

  // 路径类字段保存:onBlur 时调用
  function flushPathField(key: keyof ServerConfigPatch) {
    const v = pathDirtyRef.current[key];
    if (v === undefined) return;
    delete pathDirtyRef.current[key];
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    flush({ [key]: v } as ServerConfigPatch);
  }

  function cancelPathField(key: keyof ServerConfigPatch) {
    // 先同步失效待提交引用，避免随后的 blur 或旧 debounce 再次保存。
    delete pathDirtyRef.current[key];
    save.clearFailedFields([key]);
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function confirmPathField(key: keyof ServerConfigPatch) {
    if (pathDirtyRef.current[key] !== undefined) flushPathField(key);
    else save.retryFailed([key]);
  }

  if (isLoading) {
    return <div className="text-body text-fg-muted">加载中…</div>;
  }

  if (!data) {
    const localOnly =
      queryError instanceof ApiError &&
      queryError.code === "local_access_required";
    return (
      <div className="rounded-md border border-border-faint bg-bg-elevated px-4 py-4">
        <p className="text-body text-fg">
          {localOnly
            ? "服务端设置仅可在运行服务的计算机上管理"
            : "无法读取服务端设置"}
        </p>
        {!localOnly && (
          <button
            type="button"
            className="mt-3 h-8 px-3 rounded-md border border-border text-meta hover:bg-bg-subtle"
            onClick={() => void refetch()}
          >
            重试
          </button>
        )}
      </div>
    );
  }

  const fieldValue = (
    key: keyof ServerConfigPatch,
  ): string | number | boolean => {
    // 当前编辑 > 最新保存中值 > 保留的失败输入 > 服务端确认值。
    if (key in draft && draft[key] !== undefined) {
      return draft[key] as never;
    }
    if (pendingValues[key] !== undefined) return pendingValues[key] as never;
    if (failedValues[key as keyof typeof failedValues] !== undefined)
      return failedValues[key as keyof typeof failedValues] as never;
    return (data as ServerConfig)[key as keyof ServerConfig] as never;
  };
  const fieldStatus = (key: keyof ServerConfigPatch): FieldStatus => {
    if (draft[key] !== undefined) return "idle";
    if (pendingValues[key] !== undefined) return "saving";
    if (failedValues[key as keyof typeof failedValues] !== undefined)
      return "error";
    return status[key] ?? "idle";
  };

  return (
    <div className="space-y-6">
      {save.hasFailures && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-body text-fg space-y-2"
        >
          <p>
            部分配置的保存结果未能确认。可重试保留的输入，或重新读取当前配置。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {save.isReading ? (
              <>
                <span className="text-meta text-fg-muted">
                  正在重新读取配置…
                </span>
                <button
                  type="button"
                  onClick={save.cancelRead}
                  className="h-8 px-3 rounded-md border border-border text-meta hover:bg-bg-subtle"
                >
                  取消读取
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!save.canRetry}
                  onClick={() => save.retryFailed()}
                  className="h-8 px-3 rounded-md bg-accent text-accent-contrast text-meta disabled:opacity-50"
                >
                  重试保存
                </button>
                <button
                  type="button"
                  disabled={save.hasPending}
                  onClick={() => void save.readCurrent()}
                  className="h-8 px-3 rounded-md border border-border text-meta hover:bg-bg-subtle disabled:opacity-50"
                >
                  重新读取配置
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <fieldset disabled={save.isReading} className="min-w-0 space-y-6">
        {/* 媒体库 — 多根(独立渲染) */}
        <SettingsGroup title="媒体库">
          <MediaRootsField
            // 草稿优先，其次是保存中与失败的输入，最后使用服务端确认值。
            roots={
              draft.mediaRoots ??
              pendingValues.mediaRoots ??
              failedValues.mediaRoots ??
              data.mediaRoots ??
              []
            }
            status={fieldStatus("mediaRoots")}
            allowOsOpen={data.allowOsOpen}
            onChange={(next) => {
              setDraft((d) => ({ ...d, mediaRoots: next }));
              pathDirtyRef.current.mediaRoots = next;
              setStatus((s) =>
                s["mediaRoots"] === "saved" ? { ...s, mediaRoots: "idle" } : s,
              );
            }}
            onOpenInExplorer={openConfiguredDirectory}
            onCancel={() => cancelPathField("mediaRoots")}
            onConfirm={() => save.retryFailed(["mediaRoots"])}
            onCompositionChange={(active) =>
              setFieldComposing("mediaRoots", active)
            }
          />
        </SettingsGroup>

        {/* 扫描 — 排除规则(独立渲染,行为与 MediaRootsField 类似但用 textarea) */}
        <SettingsGroup title="扫描">
          <ExcludeRulesField
            patterns={
              draft.excludePatterns ??
              pendingValues.excludePatterns ??
              failedValues.excludePatterns ??
              data.excludePatterns ??
              []
            }
            systemFiles={
              draft.systemFiles ??
              pendingValues.systemFiles ??
              failedValues.systemFiles ??
              data.systemFiles ??
              []
            }
            skipHidden={
              draft.skipHidden ??
              pendingValues.skipHidden ??
              failedValues.skipHidden ??
              data.skipHidden
            }
            patternsStatus={fieldStatus("excludePatterns")}
            systemFilesStatus={fieldStatus("systemFiles")}
            skipHiddenStatus={fieldStatus("skipHidden")}
            onPatternsChange={(next) => {
              setDraft((d) => ({ ...d, excludePatterns: next }));
              pathDirtyRef.current.excludePatterns = next;
              setStatus((s) =>
                s["excludePatterns"] === "saved"
                  ? { ...s, excludePatterns: "idle" }
                  : s,
              );
            }}
            onSystemFilesChange={(next) => {
              setDraft((d) => ({ ...d, systemFiles: next }));
              pathDirtyRef.current.systemFiles = next;
              setStatus((s) =>
                s["systemFiles"] === "saved"
                  ? { ...s, systemFiles: "idle" }
                  : s,
              );
            }}
            onSkipHiddenChange={(v) => {
              setDraft((d) => ({ ...d, skipHidden: v }));
              setStatus((s) =>
                s["skipHidden"] === "saved" ? { ...s, skipHidden: "idle" } : s,
              );
            }}
            onPatternsCommit={() => flushPathField("excludePatterns")}
            onSystemFilesCommit={() => flushPathField("systemFiles")}
          />
        </SettingsGroup>

        <SettingsGroup title="访问控制">
          <div className="px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-body text-fg">
                  {data.accessMode === "lan" ? "局域网令牌保护" : "仅本机访问"}
                </div>
                <p className="text-meta text-fg-subtle mt-1 leading-5 max-w-xl">
                  {data.accessMode === "lan"
                    ? "远程浏览器必须用令牌换取 8 小时会话；令牌不会回显。"
                    : "默认模式，所有 API 只允许运行服务的计算机访问。"}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-border px-2 py-1 text-meta text-fg-muted">
                {data.accessMode === "lan" ? "LAN" : "LOCAL"}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={accessTokenDraft}
                onChange={(event) => {
                  setAccessTokenDraft(event.target.value);
                  setAccessError("");
                }}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={256}
                aria-label={
                  data.accessMode === "lan" ? "新访问令牌" : "LAN 访问令牌"
                }
                placeholder={
                  data.accessMode === "lan" && data.accessTokenConfigured
                    ? "输入至少 32 位新令牌以轮换"
                    : "至少 32 个无空白字符"
                }
                className="h-9 min-w-72 flex-1 rounded-md border border-border-faint bg-bg-subtle px-3 font-mono text-body focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={
                  update.isPending || accessTokenDraft.trim().length < 32
                }
                onClick={() => void enableLANAccess()}
                className="h-9 px-3 rounded-md bg-accent text-accent-contrast text-meta font-medium disabled:opacity-50"
              >
                {data.accessMode === "lan" ? "轮换令牌" : "开启 LAN 访问"}
              </button>
              {data.accessMode === "lan" && (
                <button
                  type="button"
                  disabled={update.isPending}
                  onClick={() => void disableLANAccess()}
                  className="h-9 px-3 rounded-md border border-border text-meta text-fg-muted hover:bg-bg-subtle disabled:opacity-50"
                >
                  切换为仅本机
                </button>
              )}
            </div>
            {accessError && (
              <p role="alert" className="mt-2 text-meta text-danger">
                {accessError}
              </p>
            )}
            <p className="mt-2 text-meta text-fg-subtle">
              对外访问还需将监听地址设为局域网 IP 或
              0.0.0.0；修改监听地址需重启。内置服务不提供
              TLS，请仅用于可信家庭网络。
            </p>
          </div>
        </SettingsGroup>

        {FIELDS.map((group) => (
          <SettingsGroup key={group.section} title={group.section}>
            <div className="divide-y divide-border-faint">
              {group.defs.map((def) => {
                const statusKey = def.key;
                const st = fieldStatus(statusKey);
                const requiresRestart = REQUIRES_RESTART.has(def.key as string);
                const isPath = PATH_FIELDS.has(def.key as string);
                return (
                  <ServerConfigField
                    key={def.key}
                    def={def}
                    value={fieldValue(def.key)}
                    status={st}
                    requiresRestart={requiresRestart}
                    isPath={isPath}
                    allowOsOpen={data.allowOsOpen}
                    onChange={(v) => {
                      // 每次输入只更新草稿;非路径字段 debounce 后再 flush,
                      // 路径字段由 onBlur 触发 flush
                      setDraft((d) => ({ ...d, [def.key]: v as never }));
                      if (isPath) {
                        pathDirtyRef.current[def.key] = v;
                        setStatus((s) =>
                          s[statusKey] === "saved"
                            ? { ...s, [statusKey]: "idle" }
                            : s,
                        );
                      } else {
                        setStatus((s) =>
                          s[statusKey] === "saved"
                            ? { ...s, [statusKey]: "idle" }
                            : s,
                        );
                      }
                    }}
                    onCommit={
                      isPath ? () => flushPathField(def.key) : undefined
                    }
                    onConfirm={() => confirmPathField(def.key)}
                    onCancel={() => cancelPathField(def.key)}
                    onCompositionChange={(active) =>
                      setFieldComposing(def.key, active)
                    }
                  />
                );
              })}
            </div>
          </SettingsGroup>
        ))}

        {save.needsScan && (
          <div className="bg-accent/5 border border-accent/30 rounded-md px-4 py-3 flex items-center justify-between gap-3 text-body">
            <div className="flex items-center gap-2 text-fg">
              <RefreshIcon size={14} />
              <span>媒体根目录配置已确认，建议重新扫描以刷新媒体库</span>
            </div>
            <button
              disabled={!save.canScan || scanSSE.isRunning}
              onClick={async () => {
                try {
                  const { scanId } = await scanApi.start();
                  scanSSE.startWith(scanId);
                  save.clearScanNotice();
                  pushToast({ kind: "success", message: "已开始重新扫描" });
                } catch {
                  pushToast({ kind: "error", message: "启动扫描失败" });
                }
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-accent/40 text-accent hover:bg-accent/10 text-meta transition-colors disabled:opacity-50"
            >
              <RefreshIcon size={11} />
              立即重新扫描
            </button>
          </div>
        )}

        <div className="text-meta text-fg-subtle leading-relaxed px-1">
          配置文件路径:
          <code className="font-mono text-fg-muted">{data.configPath}</code>;
          改完自动写回 YAML,无需手动保存。
        </div>
      </fieldset>
    </div>
  );
}
