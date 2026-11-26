import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PageHeader } from "../shell/PageHeader";
import { SplitLayout } from "../shell/SplitLayout";
import { Page } from "../shell/Page";
import { SplitNav } from "../shell/SplitLayout";
import { useTaskCenter } from "../hooks/useTaskCenter";
import { TAB_PAGES, resolveTab, tabRoute } from "../utils/pageTabs";
import TaskConsole from "../features/tasks/TaskConsole";
import TaskSummary from "../features/tasks/TaskSummary";
import TaskQueuePanel from "../features/tasks/TaskQueuePanel";
import ComputeHardwarePanel from "../features/tasks/ComputeHardwarePanel";
import DailyPlanPanel from "../features/tasks/DailyPlanPanel";
import JobHistoryPanel from "../features/tasks/JobHistoryPanel";
import SmartAlbumRefreshPanel from "../features/tasks/SmartAlbumRefreshPanel";
import StorageSection from "../features/tasks/StorageSection";

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
  const page = TAB_PAGES.tasks;
  const tab = resolveTab(page, tabParam);
  // 不认识的页签落回缺省页签。
  if (tabParam !== undefined && tabParam !== tab) {
    return <Navigate to={tabRoute(page, tab)} replace />;
  }
  return <TaskCenterView tab={tab} />;
}

/**
 * 任务中心的内容。
 *
 * 与路由分开，是为了单测能直接渲染它；数据 hook 留在这一层，页面不重挂
 * 载 —— 已选的分析模块、增量/全量与没保存的每日计划草稿都在里面。
 */
export function TaskCenterView({ tab }: { tab: string }) {
  const center = useTaskCenter(tab);
  const { snapshot, active, queue, history, plan } = center;
  const taskActionsBusy = center.busy || center.gpuSaving;
  // 队列里排着人脸任务时不能切换模型：换了会让两个任务用不同的模型。
  const runBusy =
    taskActionsBusy ||
    center.faceModelSaving ||
    queue.some((job) => job.type === "face" || job.type === "portrait");

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

  return (
    <>
      {/* 任务中心是一页窄内容：状态摘要、控制台与队列排在一栏里，
          宽屏上不会把「状态」甩到左边、把「按钮」甩到右边。 */}
      <Page variant="split" className="page-shell tasks-page [container-type:inline-size] [container-name:tasks] [&_:is(.bg-bg-subtle,_.bg-bg-subtle\/50,_.bg-bg-strong)_.text-fg-subtle]:text-fg-muted pb-12">
        <PageHeader
          title="任务中心"
          meta="管理本机分析、等待队列及每日计划。"
          actions={
            <Link className="btn btn-sm btn-outline" to="/settings/server">
              服务设置
            </Link>
          }
        />

        <SplitLayout
          navigation={
            <SplitNav
              page={TAB_PAGES.tasks}
              active={tab}
              label="任务中心分区"
              runStatus={active?.status ?? history[0]?.status}
            />
          }
        >
          {visited.has("run") && (
            <section
              aria-label="运行分区"
              id="tasks-panel-run"
              hidden={tab !== "run"}
            >
              <div className="mt-6">
                {/* 状态摘要：现在在干什么、还剩多少、能做什么。 */}
                {center.loadError ? (
                  <section
                    aria-label="状态摘要"
                    role="alert"
                    className="rounded-card bg-bg-elevated p-7 shadow-1"
                  >
                    <h2 className="text-title-2">与服务端的连接中断</h2>
                    <button
                      type="button"
                      className="btn btn-outline mt-3"
                      onClick={center.reconnect}
                    >
                      重新连接
                    </button>
                  </section>
                ) : (
                  <TaskSummary
                    active={active}
                    lastJob={history[0]}
                    loading={center.loading}
                    busy={runBusy}
                    cancelling={center.cancelling}
                    modules={snapshot?.modules ?? []}
                    queuedCount={queue.length}
                    selection={center.selection}
                    estimate={center.estimate}
                    embeddingStatus={center.embeddingStatus}
                    peopleEnabled={plan.peopleEnabled}
                    faceModel={center.faceModel}
                    onStart={() =>
                      center.start(
                        center.selection.module,
                        center.selection.mode,
                      )
                    }
                    onAction={center.act}
                  />
                )}
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
                  <p role="status" className="mt-3 text-caption text-warning">
                    本次按序启动已跳过未就绪模块：
                    {center.sequenceSkipped
                      .map((module) => module.name)
                      .join("、")}
                    。可在「本机存储」页签查看模型与运行环境。
                  </p>
                ) : null}
                {center.operationError ? (
                  <p role="alert" className="mt-2 text-caption text-danger">
                    {center.operationError}
                  </p>
                ) : null}
              </div>
            </section>
          )}

          {visited.has("plan") && (
            <section
              aria-label="每日计划分区"
              id="tasks-panel-plan"
              hidden={tab !== "plan"}
            >
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
            </section>
          )}

          {visited.has("history") && (
            <section
              aria-label="任务记录分区"
              id="tasks-panel-history"
              hidden={tab !== "history"}
            >
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
            </section>
          )}

          {visited.has("storage") && (
            <section
              aria-label="本机存储分区"
              id="tasks-panel-storage"
              hidden={tab !== "storage"}
            >
              <div className="mt-6">
                <StorageSection />
              </div>
            </section>
          )}
        </SplitLayout>
      </Page>
    </>
  );
}
