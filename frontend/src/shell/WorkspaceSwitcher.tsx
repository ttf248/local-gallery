import {Menu} from "../ui/Menu";
import {Segmented} from "../ui/Segmented";
import {ChevronDownIcon} from "../ui/icons";
import type {AppMode} from "../api/library";
import {BrandMark} from "./BrandMark";
export default function WorkspaceSwitcher({mode,onChange,compact,mobile}:{mode:AppMode;onChange:(mode:AppMode)=>void;compact?:boolean;mobile?:boolean}){
  const options=[{value:"photo",label:"照片"},{value:"comic",label:"漫画"}] as const;
  if(mobile)return <Segmented label="工作台模式" value={mode} options={[...options]} onChange={onChange} className="w-full [&_[role=radiogroup]]:w-full [&_button]:flex-1"/>;
  const current=options.find(item=>item.value===mode)!;
  return <Menu label="切换工作台" trigger={<button type="button" aria-label={`当前工作台：${current.label}，切换工作台`} className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-label font-semibold hover:bg-hover">
    <BrandMark/>{!compact && <>{current.label}<ChevronDownIcon size={16}/></>}
  </button>} items={options.map(({value,label})=>({id:value,label,checked:mode===value,onSelect:()=>{if(value!==mode)onChange(value);}}))}/>;
}

