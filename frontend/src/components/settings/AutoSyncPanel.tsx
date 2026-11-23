import { useState } from "react";
import { describeSyncError } from "../../api/librarySync";
import {
  useLibrarySyncStatus,
  useUpdateLibrarySync,
} from "../../hooks/useLibrarySync";
import Toggle from "../common/Toggle";
import { Row, Section } from "./SettingsSection";
import { RefreshIcon } from "../common/Icon";

/** 把时间戳显示成本地时间；没有时间戳时返回空串。 */
function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** 监听状态的一句话说明。 */
function describeWatchState(
  enabled: boolean,
  running: boolean,
  degraded: boolean,
): string {
  if (!enabled) return "已关闭，文件变化不会自动更新图库";
  if (degraded) return "监听不稳定，已改用定期校验兜底";
  if (running) return "正在监听媒体目录";
  return "监听已启动，等待文件变化";
}

/**
 * 自动发现文件变化。
 *
 * 这一块讲的是「图库怎么跟上磁盘」：开关、监听情况，以及最近一次
 * 同步检出了多少变化、真正更新了多少资源。
 */
export default function AutoSyncPanel() {
  const query = useLibrarySyncStatus();
  const update = useUpdateLibrarySync();
  const [error, setError] = useState("");
  // 保存中才禁用开关：状态是定时轮询的，若跟着轮询一起禁用，
  // 用户会在轮询的那一瞬间点不动开关。
  const [saving, setSaving] = useState(false);

  const status = query.data;
  const enabled = status?.enabled ?? false;
  const autoAnalyze = status?.autoAnalyze ?? false;

  const apply = async (patch: { enabled?: boolean; autoAnalyze?: boolean }) => {
    setError("");
    setSaving(true);
    try {
      await update(patch);
    } catch {
      setError("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const failure = describeSyncError(status?.lastError);

  return (
    <Section
      id="auto-sync"
      title="自动发现文件变化"
      icon={<RefreshIcon size={13} />}
      description="目录变化后自动增量更新图库"
    >
      <Row label="自动发现文件变化">
        <Toggle
          label="自动发现文件变化"
          checked={enabled}
          disabled={saving}
          onChange={(value) => void apply({ enabled: value })}
        />
      </Row>
      <Row label="变化后自动分析">
        <Toggle
          label="变化后自动分析"
          checked={autoAnalyze}
          disabled={!enabled || saving}
          onChange={(value) => void apply({ autoAnalyze: value })}
        />
      </Row>
      <div className="settings-block">
        <div>
          <span className="text-body text-fg">监听状态</span>
          <span className="block mt-0.5 text-meta text-fg-muted">
            {status
              ? describeWatchState(enabled, status.running, status.degraded)
              : "正在读取…"}
          </span>
        </div>
        {status && (
          <dl className="mt-2 grid max-w-md grid-cols-2 gap-x-8 gap-y-1 text-meta text-fg-muted">
            <dt>监听目录</dt>
            <dd className="text-fg">
              {status.watchedDirs} / {status.maxWatchDirs}
            </dd>
            <dt>最近检测</dt>
            <dd className="text-fg">{status.lastDetected} 项</dd>
            <dt>最近更新</dt>
            <dd className="text-fg">{status.lastUpdated} 项</dd>
            <dt>上次校验</dt>
            <dd className="text-fg">{formatTime(status.lastVerifyAt) || "尚未校验"}</dd>
            <dt>上次同步</dt>
            <dd className="text-fg">{formatTime(status.lastSyncAt) || "尚未同步"}</dd>
          </dl>
        )}
        {(failure || error) && (
          <p className="mt-2 text-meta text-danger">{error || failure}</p>
        )}
      </div>
    </Section>
  );
}
