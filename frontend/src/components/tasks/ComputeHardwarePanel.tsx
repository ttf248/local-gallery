import type { AIWorkerStatus } from "../../api/aiJobs";

interface Props {
  gpuEnabled: boolean;
  disabled: boolean;
  saving: boolean;
  saveError: boolean;
  status?: AIWorkerStatus;
  statusLoading: boolean;
  onChange: (enabled: boolean) => void;
}

/**
 * 硬件方案：新建的模型任务跑在 GPU 还是 CPU 上。
 *
 * 这是一个开关，不是一段说明：开关与它当前的状态并排摆在一行，
 * 详细的口径（哪些任务受影响、失败时怎么办）收进下面的详情里 ——
 * 开了 GPU 的人要知道它到底改变了什么，但不必每次都读一遍。
 */
export default function ComputeHardwarePanel({
  gpuEnabled,
  disabled,
  saving,
  saveError,
  status,
  statusLoading,
  onChange,
}: Props) {
  const gpuReady = Boolean(
    status?.cudaAvailable && status.cudaExecutionProviderAvailable,
  );

  return (
    <section className="tasks-section" aria-labelledby="hardware-heading">
      <div className="tasks-section__head">
        <div className="min-w-0">
          <h2 id="hardware-heading" className="tasks-section__title">
            硬件方案
          </h2>
          <p className="tasks-section__desc">
            {gpuEnabled
              ? "向量、文字识别与人脸分析任务强制使用 NVIDIA GPU；不可用时任务会失败并记录原因，不会转用 CPU。"
              : "向量、文字识别与人脸分析任务使用 CPU 推理；照片元数据始终由 CPU 处理。"}
          </p>
        </div>
        <label
          className={`inline-flex shrink-0 items-center gap-2.5 text-label text-fg ${
            disabled || saving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={gpuEnabled}
            disabled={disabled || saving}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
          <span>{saving ? "保存中…" : "强制使用 GPU"}</span>
        </label>
      </div>

      <div className="tasks-section__body">
        <p className="text-meta text-fg-subtle" role="status">
          {statusLoading
            ? "正在检查本机 GPU 运行环境…"
            : gpuReady
              ? `${status?.gpuName ?? "NVIDIA GPU"} · CUDA ${status?.cudaVersion ?? "可用"} · ONNX GPU 运行时可用`
              : status?.cudaAvailable
                ? "已检测到 NVIDIA GPU；ONNX GPU 运行时未就绪，OCR 与人脸 GPU 任务将记录错误。"
                : "未检测到可用的 NVIDIA CUDA 运行环境；GPU 模式下的模型任务会记录错误。"}
        </p>
        {saveError ? (
          <p role="alert" className="mt-2 text-meta text-danger">
            硬件方案保存失败，请重试。
          </p>
        ) : null}

        <details className="tasks-advanced">
          <summary className="tasks-advanced__summary">
            硬件与运行环境详情
          </summary>
          <div className="tasks-advanced__body">
            <p className="text-meta leading-relaxed text-fg-muted">
              {gpuEnabled
                ? "新建的向量、文字识别和人脸分析任务强制使用 NVIDIA GPU；GPU 不可用或推理失败时，任务会失败并记录原因，不会转用 CPU。已排队任务保留创建时的设备选择。照片元数据解析始终由 CPU 处理。"
                : "新建的向量、文字识别和人脸分析任务使用 CPU 推理。已排队任务保留创建时的设备选择；照片元数据解析始终由 CPU 处理。"}
            </p>
            <p className="mt-2 text-meta text-fg-subtle">
              推理设备与模型状态在运行页的「高级信息」里；模型权重在「本机存储」页签。
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
