import type { ReactNode } from "react";
import type { AIJobModule } from "../../api/aiJobs";
import { ImageIcon, LayersIcon, LibraryIcon } from "../../ui/icons";
import { taskScope } from "../../utils/taskFormat";

const groups = [
  { name: "全库通用", Icon: LayersIcon },
  { name: "照片相册", Icon: ImageIcon },
  { name: "漫画书架", Icon: LibraryIcon },
] as const;

export default function TaskModuleGroups({
  modules,
  className,
  children,
}: {
  modules: AIJobModule[];
  className: string;
  children: (module: AIJobModule) => ReactNode;
}) {
  return groups.map(({ name, Icon }) => {
    const entries = modules.filter((module) => taskScope[module.type] === name);
    if (!entries.length) return null;
    return (
      <fieldset key={name} className="min-w-0">
        <legend className="mb-1.5 px-1 text-caption font-semibold text-ink-2">
          <span className="flex items-center gap-1.5">
            <Icon size={15} aria-hidden="true" />
            {name}
          </span>
        </legend>
        <div className={className}>{entries.map(children)}</div>
      </fieldset>
    );
  });
}
