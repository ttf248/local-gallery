import { ApiError } from "../../api/client";
import type {
  StorageAbsolutePaths,
  StorageModule,
  StorageRelativePaths,
} from "../../api/storage";

interface Props {
  relative?: StorageRelativePaths;
  /** 各分析模块的模型文件，用来给出相对路径。 */
  modules?: StorageModule[];
  absolute?: StorageAbsolutePaths;
  /** 绝对路径读取失败时的原因。 */
  absoluteError?: unknown;
  onRetryAbsolute?: () => void;
}

/**
 * 路径：相对缓存根目录的路径人人可见，绝对路径只在本机浏览器显示。
 *
 * 默认收起。路径是排查问题时的备查信息，不是每次都要看的东西 ——
 * 摊开十几行绝对路径会把这一段变成一堵墙。
 */
export default function StoragePaths({
  relative,
  modules,
  absolute,
  absoluteError,
  onRetryAbsolute,
}: Props) {
  const localOnly =
    absoluteError instanceof ApiError &&
    absoluteError.code === "local_access_required";

  return (
    <details className="group overflow-hidden rounded-xl border border-line bg-raised shadow-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-line bg-sunken px-4 py-2.5 text-body font-medium text-ink transition-colors hover:bg-sunken [&::-webkit-details-marker]:hidden">
        <span>路径</span>
        <span className="text-caption font-normal text-ink-2 group-open:hidden">
          相对缓存根目录 · 展开查看
        </span>
      </summary>

      <div className="grid gap-5 border-t border-line px-4 py-3 sm:grid-cols-2">
        {relative ? (
          <div className="min-w-0">
            <h4 className="text-caption font-medium text-ink-2">
              相对缓存根目录
            </h4>
            <dl className="mt-2">
              <PathEntry label="状态目录" path={relative.stateDirectory} />
              <PathEntry label="任务状态文件" path={relative.jobsFile} />
              <PathEntry
                label="分析批次目录"
                path={relative.metadataDirectory}
              />
              <PathEntry
                label="AI 派生目录"
                path={relative.aiDerivedDirectory}
              />
              <PathEntry label="向量目录" path={relative.vectorDirectory} />
              <PathEntry label="模型目录" path={relative.modelDirectory} />
              {modules?.flatMap((module) =>
                module.modelFiles.map((file) => (
                  <PathEntry
                    key={`${module.type}:${file.path}`}
                    label={`${module.name} · ${file.name}`}
                    path={file.path}
                  />
                )),
              )}
            </dl>
          </div>
        ) : null}

        <div className="min-w-0">
          <h4 className="text-caption font-medium text-ink-2">本机绝对路径</h4>
          {absolute && !localOnly ? (
            <dl className="mt-2">
              <PathEntry label="缓存根目录" path={absolute.cacheRoot} />
              <PathEntry label="工作目录" path={absolute.workingDirectory} />
              <PathEntry label="配置文件" path={absolute.configFile} />
              <PathEntry
                label="Python 环境"
                path={absolute.pythonEnvironment}
              />
              <PathEntry
                label="Python 启动器"
                path={absolute.pythonExecutable}
              />
              {absolute.modules.flatMap((module) =>
                module.modelFiles.map((file) => (
                  <PathEntry
                    key={`${module.type}:${file.path}`}
                    label={`${module.name} · ${file.name}`}
                    path={file.path}
                  />
                )),
              )}
            </dl>
          ) : localOnly ? (
            <p className="mt-2 text-caption leading-relaxed text-ink-3">
              完整路径只在运行服务的计算机上显示；此处列出的是相对缓存根目录的路径。
            </p>
          ) : absoluteError ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-caption text-ink-3">
              <span>本机绝对路径读取失败。</span>
              {onRetryAbsolute ? (
                <button
                  type="button"
                  className="inline-flex min-h-8 min-w-8 touch:min-h-10 touch:min-w-10 items-center rounded-md border border-line px-2.5 text-caption text-ink-2 transition-colors hover:bg-sunken"
                  onClick={onRetryAbsolute}
                >
                  重试
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function PathEntry({ label, path }: { label: string; path: string }) {
  return (
    <div className="min-w-0 border-t border-line py-2 first:border-0">
      <dt className="text-caption text-ink-3">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-caption leading-relaxed text-ink">
        {path || "未配置"}
      </dd>
    </div>
  );
}
