import { SettingsGroup, SettingsRow } from "../../ui/SettingsList";
import type {
  AIJob,
  AIJobEstimate,
  AIJobModule,
  AIWorkerStatus,
  FaceModel,
  AnalysisMode,
  AnalysisType,
} from "../../api/aiJobs";
import type { TaskCenterSelection } from "../../hooks/useTaskCenter";
import { formatCount, formatEstimateDuration } from "../../utils/taskFormat";
import ModuleTiles from "./ModuleTiles";
import Segmented from "../../ui/Segmented";
import TaskEstimatePanel from "./TaskEstimatePanel";

interface Props {
  loading: boolean;
  /** 启动或任务操作正在提交。 */
  busy: boolean;
  modules: AIJobModule[];
  history: AIJob[];
  peopleEnabled: boolean;
  faceModel: FaceModel;
  faceModelSaving: boolean;
  faceModelSaveError: boolean;
  onChangeFaceModel: (model: FaceModel) => void;
  embeddingStatus?: AIWorkerStatus;
  embeddingStatusLoading: boolean;
  /** 选中的模块与处理方式。 */
  selection: TaskCenterSelection;
  /** 空闲时的规模与耗时核算。 */
  estimate?: AIJobEstimate;
  estimateLoading: boolean;
  estimateError: boolean;
  onStartAll: (mode: AnalysisMode) => void;
  onRefreshEstimate: () => void;
}

/**
 * 这次要跑什么：选模块、选口径、看清楚要处理多少张。
 *
 * 启动按钮不在这里 —— 它在上面的状态摘要里，紧挨着「现在是什么状态」
 * 那一行，用户不用在页面里找按钮在哪。这一块只回答「跑什么、跑多少」。
 */
export default function TaskConsole({
  loading,
  busy,
  modules,
  history,
  peopleEnabled,
  faceModel,
  faceModelSaving,
  faceModelSaveError,
  onChangeFaceModel,
  embeddingStatus,
  embeddingStatusLoading,
  selection,
  estimate,
  estimateLoading,
  estimateError,
  onStartAll,
  onRefreshEstimate,
}: Props) {
  const { module: selectedModule, mode } = selection;
  const installedModules = modules.filter((module) => module.installed);

  // 加载中由上面的状态摘要占位：这里再摆一块骨架只是重复。
  if (loading) return null;

  const selectedName =
    installedModules.find((module) => module.type === selectedModule)?.name ??
    "照片元数据";
  const selectedModuleVersion =
    installedModules.find((module) => module.type === selectedModule)
      ?.version ?? "";
  const sequence = estimate ? estimate.sequence[mode] : null;
  const buffaloReady = Boolean(embeddingStatus?.faceModels?.buffalo_m?.ready);
  const qualityReady = Boolean(
    embeddingStatus?.faceModels?.["quality-v2"]?.ready ??
    embeddingStatus?.modules?.face?.ready,
  );
  const selectedFaceModelReady =
    faceModel === "buffalo_m" ? buffaloReady : qualityReady;

  return (
    <section className="mt-8" aria-labelledby="run-config-heading">
      <div className="mb-3">
        <div className="min-w-0">
          <h2 id="run-config-heading" className="text-title-3">
            这次要跑什么
          </h2>
          <p className="mt-1 text-caption text-fg-muted">
            {moduleDescription(selectedModule)}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-6">
          <div className="min-w-0">
            <ModuleTiles
              modules={modules}
              history={history}
              estimate={estimate}
              mode={mode}
              selected={[selectedModule]}
              onToggle={(type) => selection.setModule(type)}
              disabled={busy}
              locked={peopleEnabled ? [] : ["face"]}
            />
          </div>
        </div>

        <SettingsGroup title="处理方式">
          <SettingsRow label="分析模式">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented
                label="处理方式"
                value={mode}
                onChange={selection.setMode}
                disabled={busy}
                options={[
                  { value: "incremental", label: "增量" },
                  { value: "full", label: "全量" },
                ]}
              />
              <span className="text-caption text-fg-subtle">
                {modeHint(selectedModule, mode, selectedName)}
              </span>
            </div>
          </SettingsRow>
          <SettingsRow label="人脸模型">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented
                label="人脸分析模型"
                value={faceModel}
                onChange={onChangeFaceModel}
                disabled={busy || faceModelSaving || embeddingStatusLoading}
                options={[
                  {
                    value: "quality-v2",
                    label: "quality-v2",
                    title: "当前质量优化版，128 维特征",
                    disabled: !qualityReady,
                  },
                  {
                    value: "buffalo_m",
                    label: "Buffalo_m",
                    title: "SCRFD 检测与 ResNet50 特征，512 维",
                    disabled: !buffaloReady,
                  },
                ]}
              />
              <span className="text-caption text-fg-subtle">
                {selectedFaceModelReady
                  ? faceModel === "buffalo_m"
                    ? "512 维特征 · Buffalo_m"
                    : "128 维特征 · quality-v2"
                  : "所选模型未就绪，请在本机存储页签安装模型"}
              </span>
              {faceModelSaving ? (
                <span className="text-caption text-fg-subtle">
                  正在切换并重建人物索引…
                </span>
              ) : null}
              {faceModelSaveError ? (
                <span role="alert" className="text-caption text-danger">
                  模型切换失败，检查是否有正在运行的人脸任务后重试。
                </span>
              ) : null}
            </div>
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup title="本次规模">
          <div className="min-w-0">
            <TaskEstimatePanel
              onModeChange={selection.setMode}
              disabled={busy}
              estimate={estimate}
              loading={estimateLoading}
              error={estimateError}
              module={selectedModule}
              mode={mode}
              onRefresh={onRefreshEstimate}
            />
          </div>
        </SettingsGroup>

        <div className="tasks-actions flex flex-wrap items-center gap-y-2 gap-x-4 py-3 px-0 border-t border-t-line">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={busy || installedModules.length === 0}
            onClick={() => onStartAll(mode)}
          >
            按序启动全部任务
          </button>
          {sequence && sequence.modules.length > 0 ? (
            <span className="text-caption text-fg-subtle">
              {`${sequence.modules.length} 个模块 · ${formatCount(sequence.count)} 张`}
            </span>
          ) : null}
          {sequence && sequence.modules.length > 0 ? (
            <span className="text-caption text-fg-subtle">
              {formatEstimateDuration(sequence.estimatedDurationMs)}
            </span>
          ) : null}
        </div>

        {/* 高级信息：版本、运行环境与索引覆盖。日常用不到，但它决定
            「为什么这次跑不起来」，所以收起来而不是删掉 —— 摘要里给出
            的提示会指向这里。 */}
        <details className="tasks-advanced border-t border-t-line">
          <summary className="tasks-advanced__summary flex items-baseline gap-3 py-2.5 px-0 cursor-pointer text-body text-fg [list-style:none] [&::-webkit-details-marker]:hidden before:content-['▸'] before:text-micro before:text-fg-subtle [.tasks-advanced[open]>&::before]:content-['▾']">
            高级信息
            <span className="text-caption text-fg-subtle">
              {selectedModuleVersion
                ? `模块版本 ${selectedModuleVersion}`
                : "模块版本与运行环境"}
            </span>
          </summary>
          <div className="tasks-advanced__body [padding:2px_0_14px]">
            {selectedModuleVersion ? (
              <p className="text-caption text-fg-muted">
                当前模块：{selectedName} · {selectedModuleVersion}
              </p>
            ) : null}
            {selectedModule === "embedding" ? (
              <EmbeddingRuntimeStatus
                status={embeddingStatus}
                loading={embeddingStatusLoading}
              />
            ) : selectedModule === "ocr" || selectedModule === "face" ? (
              <ImageModuleRuntimeStatus
                moduleType={selectedModule}
                status={embeddingStatus}
                loading={embeddingStatusLoading}
              />
            ) : null}
          </div>
        </details>
      </div>
    </section>
  );
}

function moduleDescription(type: AnalysisType): string {
  switch (type) {
    case "embedding":
      return "用本机 Chinese-CLIP 为照片建立中文语义向量，可按描述搜索，也能按照片查找相似画面。";
    case "ocr":
      return "用本机 OCR 识别照片中的文字，结果可在图片详情中查看。";
    case "portrait":return "逐张核对已有的人脸分组，优先选择清晰、接近正面的头像。";
    case "face":
      return "检测照片中的人脸并生成本机特征向量，可查找相似人脸；不会推断或标注真实姓名。";
    case "similarity":
      return "在本机提取照片的内容指纹、感知哈希与质量指标，用来发现重复、裁剪改过的副本与连拍；不联网，也不改动原始文件。";
    default:
      return "读取照片拍摄时间、相机信息与 GPS 坐标，结果只写进本机的派生缓存。";
  }
}

/** 一句话说明这次会处理多少 —— 不另起一段解释文字。 */
function modeHint(
  type: AnalysisType,
  mode: AnalysisMode,
  moduleName: string,
): string {
  if (mode === "full") {
    return type === "metadata"
      ? "重新解析当前媒体库的全部图片"
      : `重新运行${moduleName}分析`;
  }
  return type === "metadata"
    ? "只处理新增、修改或解析器更新的图片"
    : "只处理新增或变更的图片";
}

function EmbeddingRuntimeStatus({
  status,
  loading,
}: {
  status?: AIWorkerStatus;
  loading: boolean;
}) {
  if (loading) {
    return <p className="text-caption text-fg-subtle">正在读取本机 AI 状态…</p>;
  }
  if (!status) {
    return (
      <p role="status" className="text-caption text-warning">
        本机语义模型状态暂不可读，请检查 AI Worker 运行环境。
      </p>
    );
  }
  const coverage =
    status.coverage.total > 0
      ? `${status.coverage.indexed.toLocaleString()} / ${status.coverage.total.toLocaleString()} 张已建向量`
      : "尚无可索引图片";
  return (
    <div className="grid gap-2 text-caption sm:grid-cols-2">
      <p className="text-fg-muted">
        运行设备：
        <span className="text-fg">
          {status.device === "cuda"
            ? `${status.gpuName ?? "NVIDIA GPU"} · CUDA ${status.cudaVersion ?? "可用"}`
            : status.runtimeReady
              ? "CPU 回退"
              : "运行环境未就绪"}
        </span>
      </p>
      <p className="text-fg-muted">
        索引覆盖：<span className="text-fg tabular-nums">{coverage}</span>
      </p>
      <p className="text-fg-muted sm:col-span-2">
        模型：
        <span className="text-fg">
          {!status.runtimeReady
            ? "Python 运行环境未安装，请运行 backend/aiworker/setup.bat。"
            : !status.modelAvailable || !status.modelValid
              ? "权重缺失或校验失败；请将官方 clip_cn_vit-b-16.pt 放入 cacheDir/derived/ai/models/。"
              : `${status.modelLoaded ? "已载入" : "已校验，首次推理时载入"} · ${status.modelVersion}`}
        </span>
      </p>
    </div>
  );
}

function ImageModuleRuntimeStatus({
  moduleType,
  status,
  loading,
}: {
  moduleType: "ocr" | "face";
  status?: AIWorkerStatus;
  loading: boolean;
}) {
  const label = moduleType === "ocr" ? "文字识别" : "人脸识别";
  if (loading) {
    return <p className="text-caption text-fg-subtle">正在检查{label}运行环境…</p>;
  }
  if (!status) {
    return (
      <p role="status" className="text-caption text-warning">
        本机 AI 状态暂不可读，无法确认{label}环境。
      </p>
    );
  }
  const module = status.modules?.[moduleType];
  if (module?.ready) {
    return (
      <p role="status" className="text-caption text-success">
        {label}已就绪 · {module.version}
      </p>
    );
  }
  return (
    <p role="status" className="text-caption text-warning">
      {moduleUnavailableMessage(module?.error)}
    </p>
  );
}

function moduleUnavailableMessage(code?: string): string {
  switch (code) {
    case "python_runtime_unavailable":
      return "Python 3.11 环境不可用，请运行 backend/aiworker/setup.bat。";
    case "ocr_dependencies_missing":
      return "OCR 依赖未安装，请运行 backend/aiworker/setup.bat 并重启应用。";
    case "ocr_dependency_version_mismatch":
      return "OCR 依赖版本不匹配，请重新运行 backend/aiworker/setup.bat。";
    case "ocr_model_load_failed":
      return "OCR 模型加载失败，请重新运行安装脚本并查看终端错误。";
    case "face_dependencies_missing":
      return "人脸识别依赖未安装，请运行 backend/aiworker/setup.bat。";
    case "face_model_missing_or_checksum_invalid":
      return "人脸权重缺失或校验失败，请运行 backend/aiworker/download-model.bat。";
    case "face_model_load_failed":
      return "人脸模型加载失败，请运行 backend/aiworker/setup.bat 并重启应用。";
    default:
      return "本机识别运行环境未就绪，请运行 backend/aiworker/setup.bat 并重启应用。";
  }
}
