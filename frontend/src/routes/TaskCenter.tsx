import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {PageHeader} from "../shell/PageHeader";
import PageTabs, { PagePanel } from "../components/common/PageTabs";
import { useTaskCenter } from "../hooks/useTaskCenter";
import { TASK_TABS, TAB_PAGES, resolveTab, tabRoute } from "../utils/pageTabs";
import TaskConsole from "../components/tasks/TaskConsole";
import TaskSummary from "../components/tasks/TaskSummary";
import TaskQueuePanel from "../components/tasks/TaskQueuePanel";
import ComputeHardwarePanel from "../components/tasks/ComputeHardwarePanel";
import DailyPlanPanel from "../components/tasks/DailyPlanPanel";
import JobHistoryPanel from "../components/tasks/JobHistoryPanel";
import SmartAlbumRefreshPanel from "../components/tasks/SmartAlbumRefreshPanel";
import StorageSection from "../components/tasks/StorageSection";
import "../styles/tasks.css";

/**
 * 任务中心。
 *
 * 四段原本是四个编号区块顺次往下排（01 运行 / 02 任务记录 / 03 每日计划
 * / 04 本机存储），页面四千多像素高，要滚到第三屏才看到自己的磁盘占用。
 * 现在改成四个页签：一次只显示一件事，切换即换内容，页签的 id 在 URL
 * 路径段里（`/tasks/plan`），前进后退与深链都跟着走。
 *
 * 顺序也改了：每日计划提到任务记录之前 —— 计划是要经常调的设置，记录是
 * 事后看的日志。
 */
export default function TaskCenter() {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const page = TAB_PAGES.tasks;
  const tab = resolveTab(page, tabParam);
  // 不认识的页签落回缺省页签。
  if (tabParam !== undefined && tabParam !== tab) {
    return <Navigate to={tabRoute(page, tab)} replace />;
  }
  return (
    <TaskCenterView
      tab={tab}
      onSelectTab={(id) => navigate(tabRoute(page, id))}
    />
  );
}

/**
 * 任务中心的内容。
 *
 * 与路由分开，是为了单测能直接渲染它；数据 hook 留在这一层，页面不重挂
 * 载 —— 已选的分析模块、增量/全量与没保存的每日计划草稿都在里面。
 */
export function TaskCenterView({
  tab,
  onSelectTab,
}: {
  tab: string;
  onSelectTab: (id: string) => void;
}) {
  const center = useTaskCenter();
  const { snapshot, active, queue, history, plan } = center;
  const taskActionsBusy = center.busy || center.gpuSaving;
  // 队列里排着人脸任务时不能切换模型：换了会让两个任务用不同的模型。
  const runBusy =
    taskActionsBusy ||
    center.faceModelSaving ||
    queue.some((job) => job.type === "face");

  // 访问过的页签不卸载：面板里的筛选与展开状态是组件内状态，切走再切回
  // 不该归零。没访问过的页签不挂载。
  const [visitedTabs, setVisitedTabs] = useState<string[]>([tab]);
  useEffect(() => {
    setVisitedTabs((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
  }, [tab]);
  const visited = useMemo(
    () => new Set([...visitedTabs, tab]),
    [visitedTabs, tab],
  );

  // 切页签后内容区回到顶部：页面不重挂载，滚动位置会留着。
  useEffect(() => {
    document
      .querySelector(".app-main")
      ?.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);

  // 页签条右侧的一句补充：这一屏在做什么。
  const meta = {
    run: active ? "当前任务的进度与控制" : "队列状态与启动入口",
    plan: "按设备本地时间自动检查",
    history: `${history.length} 项`,
    storage: "派生缓存、模型与产物",
  }[tab];

  return (
    <div className="page-shell">
      {/* 任务中心是一页窄内容：状态摘要、控制台与队列排在一栏里，
          宽屏上不会把「状态」甩到左边、把「按钮」甩到右边。 */}
      <div className="container--focused tasks-page pb-12">
        <PageHeader
  title="任务中心"
  meta="管理本机分析、等待队列及每日计划。"
  actions={
            <Link className="btn btn-sm btn-outline" to="/settings/server">
              服务设置
            </Link>
          }
/>

        {center.loadError ? (
          <div className="mt-6 rounded-lg border border-border bg-bg-elevated p-5 text-body text-fg-muted">
            任务状态读取失败。请检查后端是否运行，然后刷新页面。
          </div>
        ) : null}

        <div className="mt-6">
          <PageTabs
            tabs={TASK_TABS}
            active={tab}
            onChange={onSelectTab}
            label="任务中心分区"
            idPrefix="tasks"
            meta={meta}
          />

          {visited.has("run") && (
            <PagePanel idPrefix="tasks" tab={TASK_TABS[0]} active={tab}>
              <div className="mt-6">
                {/* 状态摘要：现在在干什么、还剩多少、能做什么。 */}
                <TaskSummary
                  active={active}
                  lastJob={history[0]}
                  loading={center.loading}
                  busy={runBusy}
                  modules={snapshot?.modules ?? []}
                  queuedCount={queue.length}
                  selection={center.selection}
                  estimate={center.estimate}
                  embeddingStatus={center.embeddingStatus}
                  peopleEnabled={plan.peopleEnabled}
                  faceModel={center.faceModel}
                  onStart={() =>
                    center.start(center.selection.module, center.selection.mode)
                  }
                  onAction={center.act}
                />
                <TaskConsole
                  loading={center.loading}
                  busy={runBusy}
                  modules={snapshot?.modules ?? []}
                  history={history}
                  peopleEnabled={plan.peopleEnabled}
                  faceModel={center.faceModel}
                  faceModelSaving={center.faceModelSaving}
                  faceModelSaveError={center.faceModelSaveError}
                  onChangeFaceModel={center.setFaceModel}
                  embeddingStatus={center.embeddingStatus}
                  embeddingStatusLoading={center.embeddingStatusLoading}
                  selection={center.selection}
                  estimate={center.estimate}
                  estimateLoading={center.estimateLoading}
                  estimateError={center.estimateError}
                  onStartAll={center.startAll}
                  onRefreshEstimate={center.refreshEstimate}
                />
                <TaskQueuePanel
                  jobs={queue}
                  busy={center.busy}
                  loading={center.loading}
                  onMove={center.moveQueued}
                  onCancel={(id) => center.act(id, "cancel")}
                  onClear={center.clearQueue}
                />
                <ComputeHardwarePanel
                  gpuEnabled={center.gpuEnabled}
                  disabled={center.loading}
                  saving={center.gpuSaving}
                  saveError={center.gpuSaveError}
                  status={center.embeddingStatus}
                  statusLoading={center.embeddingStatusLoading}
                  onChange={center.setGPUEnabled}
                />
                <SmartAlbumRefreshPanel />
                {center.sequenceSkipped && center.sequenceSkipped.length > 0 ? (
                  <p role="status" className="mt-3 text-meta text-warning">
                    本次按序启动已跳过未就绪模块：
                    {center.sequenceSkipped
                      .map((module) => module.name)
                      .join("、")}
                    。可在「本机存储」页签查看模型与运行环境。
                  </p>
                ) : null}
                {center.operationError ? (
                  <p role="alert" className="mt-2 text-meta text-danger">
                    {center.operationError}
                  </p>
                ) : null}
              </div>
            </PagePanel>
          )}

          {visited.has("plan") && (
            <PagePanel idPrefix="tasks" tab={TASK_TABS[1]} active={tab}>
              <div className="mt-6">
                <DailyPlanPanel
                  enabled={plan.enabled}
                  time={plan.time}
                  selectedModules={plan.modules}
                  scanEnabled={plan.scan}
                  smartAlbumsEnabled={plan.smartAlbums}
                  peopleEnabled={plan.peopleEnabled}
                  ready={plan.ready}
                  onEnabledChange={plan.setEnabled}
                  onTimeChange={plan.setTime}
                  onModulesChange={plan.setModules}
                  onScanChange={plan.setScan}
                  onSmartAlbumsChange={plan.setSmartAlbums}
                  onPeopleEnabledChange={plan.setPeopleEnabled}
                  onSave={plan.save}
                  saving={plan.saving}
                  saved={plan.saved}
                  error={plan.error}
                  lastScheduledDate={snapshot?.settings.lastScheduledDate}
                  lastScheduledStatus={snapshot?.settings.lastScheduledStatus}
                  lastScheduledStage={snapshot?.settings.lastScheduledStage}
                  lastScheduledError={snapshot?.settings.lastScheduledError}
                  modules={snapshot?.modules ?? []}
                  estimate={center.estimate}
                  estimateLoading={center.estimateLoading}
                  estimateError={center.estimateError}
                />
              </div>
            </PagePanel>
          )}

          {visited.has("history") && (
            <PagePanel idPrefix="tasks" tab={TASK_TABS[2]} active={tab}>
              <div className="mt-6">
                <JobHistoryPanel
                  jobs={history}
                  retryDisabled={Boolean(active) || taskActionsBusy}
                  busy={taskActionsBusy}
                  onRetry={(id) => center.act(id, "retry")}
                  onDelete={center.deleteHistoryItem}
                  onClear={center.clearHistory}
                />
              </div>
            </PagePanel>
          )}

          {visited.has("storage") && (
            <PagePanel idPrefix="tasks" tab={TASK_TABS[3]} active={tab}>
              <div className="mt-6">
                <StorageSection />
              </div>
            </PagePanel>
          )}
        </div>
      </div>
    </div>
  );
}
