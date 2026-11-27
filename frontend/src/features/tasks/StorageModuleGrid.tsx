import { formatSize } from "../../utils/format";
import type { StorageModule } from "../../api/storage";

interface Props {
  modules: StorageModule[];
}

export default function StorageModuleGrid({ modules }: Props) {
  if (modules.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-raised shadow-1">
      <h3 className="border-b border-line bg-sunken px-4 py-2.5 text-body font-medium text-ink">
        AI 模型与产物
      </h3>
      <ul className="divide-y divide-line">
        {modules.map((module) => {
          const modelNames = module.modelFiles
            .map((file) => file.name)
            .join("、");
          const outputPaths = module.outputs
            .map((output) => output.path)
            .join("、");
          return (
            <li key={module.type} className="px-4 py-3">
              <details>
                <summary className="cursor-pointer list-item gap-x-3 gap-y-1">
                  <span className="text-body font-medium text-ink">
                    {module.name}
                  </span>
                  <span className="ml-3 font-mono text-caption tabular-nums text-ink-2">
                    模型 {formatSize(module.modelBytes)} · 产物{" "}
                    {formatSize(module.outputBytes)}
                  </span>
                </summary>

                {module.profiles?.length ? (
                  <ul className="mt-2 space-y-2">
                    {module.profiles.map((profile) => {
                      const profileModelNames = profile.modelFiles
                        .map((file) => file.name)
                        .join("、");
                      const profileOutputPaths = profile.outputs
                        .map((output) => `${output.label}：${output.path}`)
                        .join("、");
                      return (
                        <li
                          key={profile.model}
                          className="rounded-lg border border-line bg-sunken px-3 py-2"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span className="text-caption font-medium text-ink">
                              {faceModelLabel(profile.model)}
                              {profile.active ? (
                                <span className="ml-2 text-success">
                                  当前使用
                                </span>
                              ) : null}
                            </span>
                            <span className="font-mono text-caption tabular-nums text-ink-2">
                              模型 {formatSize(profile.modelBytes)} · 产物{" "}
                              {formatSize(profile.outputBytes)}
                            </span>
                          </div>
                          <p
                            className="mt-1 break-all font-mono text-caption text-ink-3"
                            title={profileModelNames}
                          >
                            {profileModelNames || "未发现模型文件"}
                          </p>
                          <p
                            className="mt-1 break-all font-mono text-caption text-ink-3"
                            title={profileOutputPaths}
                          >
                            {profileOutputPaths}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <>
                    {module.modelFiles.length > 0 ? (
                      <p
                        className="mt-1 break-all font-mono text-caption text-ink-3"
                        title={modelNames}
                      >
                        {modelNames}
                      </p>
                    ) : module.modelLocation === "none" ? (
                      <p className="mt-1 text-caption text-ink-3">
                        {module.type === "metadata"
                          ? "使用 Go 内置 EXIF/GPS 解析器，无需权重。"
                          : "使用内置算法，无需模型权重。"}
                      </p>
                    ) : (
                      <p className="mt-1 text-caption text-warning">
                        未发现模型文件
                      </p>
                    )}

                    <p
                      className="mt-1 break-all font-mono text-caption text-ink-3"
                      title={outputPaths}
                    >
                      {outputPaths}
                    </p>
                  </>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function faceModelLabel(model: "quality-v2" | "buffalo_m"): string {
  return model === "quality-v2"
    ? "YuNet + SFace（quality-v2）"
    : "SCRFD + ResNet50（Buffalo_m）";
}
