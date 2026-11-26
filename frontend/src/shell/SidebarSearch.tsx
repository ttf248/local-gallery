import {SearchIcon} from "../ui/icons";
import {Kbd} from "../ui/Kbd";
import {Tooltip} from "../ui/Tooltip";
export function SidebarSearch({collapsed,onSearch}:{collapsed:boolean;onSearch:()=>void}){
 const button=<button type="button" data-command-trigger aria-label="打开命令面板" aria-keyshortcuts="Control+K Meta+K /" onClick={onSearch} className="flex h-9 w-full items-center gap-2 rounded-md bg-raised px-3 text-label text-ink-3 shadow-1 hover:text-ink">
  <SearchIcon size={16}/>{!collapsed && <><span className="flex-1 text-left">搜索</span><Kbd keys={["Mod","K"]}/></>}
 </button>;
 return collapsed?<Tooltip content="搜索" side="right">{button}</Tooltip>:button;
}
