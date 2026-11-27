import {
  TaskConsole,
  TaskSummary,
  TaskQueuePanel,
  ComputeHardwarePanel,
  DailyPlanPanel,
  JobHistoryPanel,
  SmartAlbumRefreshPanel,
} from "../tasks";
import { buttonStyles } from "../../ui/buttonStyles";
import { useTaskCenter } from "../../hooks/useTaskCenter";

export default function TasksPlanTab({ active: visible }: { active: boolean }) {
  const center = useTaskCenter({ active: visible });
  const { snapshot, active, queue, history, plan } = center;
  const taskActionsBusy = center.busy || center.gpuSaving;
  // 队列里排着人脸任务时不能切换模型：换了会让两个任务用不同的模型。
  const runBusy =
    taskActionsBusy ||
    center.faceModelSaving ||
    queue.some((job) => job.type === "face" || job.type === "portrait");

  return (
    <div className="space-y-5 [&_:is(.bg-sunken,.bg-sunken-strong)_.text-ink-3]:text-ink-2">
      <div className="space-y-2">
        {center.loadError ? (
          <section
            aria-label="状态摘要"
            role="alert"
            className="rounded-lg bg-raised p-7 shadow-1"
          >
            <h2 className="text-title">与服务端的连接中断</h2>
            <button
              type="button"
              className={buttonStyles({
                variant: "secondary",
                className: "mt-3",
              })}
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
            onAction={center.act}
          />
        )}
        <TaskQueuePanel
          jobs={queue}
          busy={center.busy}
          loading={center.loading}
          onMove={center.moveQueued}
          onCancel={(id) => center.act(id, "cancel")}
          onClear={center.clearQueue}
        />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-2 xl:col-span-7">
          <TaskConsole
            gpuEnabled={center.gpuEnabled}
            active={Boolean(active)}
            connected={!center.loadError}
            onStart={() =>
              center.start(center.selection.module, center.selection.mode)
            }
            loading={center.loading}
            busy={runBusy}
            modules={snapshot?.modules ?? []}
            history={history}
            peopleEnabled={snapshot?.settings.peopleEnabled ?? false}
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
          {center.sequenceSkipped && center.sequenceSkipped.length > 0 ? (
            <p role="status" className="mt-3 text-caption text-warning">
              本次按序启动已跳过未就绪模块：
              {center.sequenceSkipped.map((module) => module.name).join("、")}
              。可在「数据与存储」页签查看模型与运行环境。
            </p>
          ) : null}
          {center.operationError ? (
            <p role="alert" className="mt-2 text-caption text-danger">
              {center.operationError}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 xl:col-span-5">
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
            dirty={plan.dirty}
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
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
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
      </div>
      <JobHistoryPanel
        jobs={history}
        retryDisabled={Boolean(active) || taskActionsBusy}
        busy={taskActionsBusy}
        onRetry={(id) => center.act(id, "retry")}
        onDelete={center.deleteHistoryItem}
        onClear={center.clearHistory}
      />
    </div>
  );
}
