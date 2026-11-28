import type { AIJob, AnalysisType } from "../../api/aiJobs";
import { Button } from "../../ui/Button";
import { ImageIcon, SearchIcon, ReaderIcon } from "../../ui/icons";

const photos: AnalysisType[] = ["metadata", "face", "similarity", "albumCover"];
const presets = [
  {
    name: "照片时光整理",
    description: "按拍摄时间、人物和地点整理照片，找出相似连拍并挑选封面。",
    modules: photos,
    icon: ImageIcon,
  },
  {
    name: "照片以文搜图增强",
    description: "整理照片，并支持按画面描述和照片中的文字搜索。",
    modules: [...photos, "embedding", "ocr"],
    icon: SearchIcon,
  },
  {
    name: "漫画书架智能整理",
    description: "为漫画挑选总封面和单卷代表图，识别作品信息与故事大纲。",
    modules: ["comicCover", "comicMeta"],
    icon: ReaderIcon,
  },
] satisfies {
  name: string;
  description: string;
  modules: AnalysisType[];
  icon: typeof ImageIcon;
}[];
export function TaskPresetCards({
  history,
  disabled,
  run,
}: {
  history: AIJob[];
  disabled: boolean;
  run: (modules: AnalysisType[]) => void;
}) {
  const completed = new Set(
    history
      .filter((job) => job.status === "completed" && !job.albumId)
      .map((job) => job.type),
  );
  return (
    <section aria-label="场景快速开始">
      <h2 className="mb-3 text-subheading">场景快速开始</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {presets.map(({ name, description, modules, icon: Icon }) => (
          <article
            key={name}
            className="flex flex-col gap-2 rounded-xl border border-line-subtle bg-raised p-4"
          >
            <div className="flex items-center gap-2">
              <Icon size={18} />
              <h3 className="text-label font-semibold">{name}</h3>
            </div>
            <p className="flex-1 text-caption text-ink-2">{description}</p>
            <span className="text-caption text-ink-2">
              {modules.length} 个模块
              {modules.every((m) => completed.has(m))
                ? " · 已就绪 · 增量补跑"
                : ""}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              aria-label={"一键运行" + name}
              onClick={() => run(modules)}
            >
              一键运行
            </Button>
          </article>
        ))}
      </div>
    </section>
  );
}
