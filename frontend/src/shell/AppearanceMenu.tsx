import {useEffect,useRef,useState} from "react";
import { MenuSurface } from "../ui/Menu";
import { IconButton } from "../ui/IconButton";
import { MonitorIcon, MoonIcon, SunIcon } from "../ui/icons";
import { useUIStore } from "../store/uiStore";
export function AppearanceMenu() {
  const theme = useUIStore((s) => s.theme),
    setTheme = useUIStore((s) => s.setTheme);
  const choices = [
    ["light", "浅色", SunIcon],
    ["dark", "深色", MoonIcon],
    ["system", "跟随系统", MonitorIcon],
  ] as const;
  const current = choices.find(([id]) => id === theme) ?? choices[2],
    Icon = current[2];
  const trigger = useRef<HTMLButtonElement>(null), timer=useRef<ReturnType<typeof setTimeout>>(), longPress=useRef(false);
  const [open,setOpen]=useState(false);
  const clear=()=>clearTimeout(timer.current);
  useEffect(()=>clear,[]);
  return <>
    <IconButton ref={trigger} label={"外观 · "+current[1]} aria-haspopup="menu" aria-expanded={open}
      onPointerDown={event=>{if(event.button!==0)return;longPress.current=false;clear();timer.current=setTimeout(()=>{longPress.current=true;setOpen(true);},500);}}
      onPointerUp={clear} onPointerLeave={clear} onPointerCancel={clear}
      onContextMenu={event=>{event.preventDefault();clear();setOpen(true);}}
      onKeyDown={event=>{if(event.key==="ArrowDown" || (event.key==="F10" && event.shiftKey)){event.preventDefault();setOpen(true);}}}
      onClick={()=>{if(longPress.current){longPress.current=false;return;}const index=choices.findIndex(item=>item[0]===theme);setTheme(choices[(index+1)%choices.length][0]);}}>
      <Icon size={20}/>
    </IconButton>
    {open && trigger.current && <MenuSurface
      label="外观" anchor={trigger.current} restoreFocus={trigger.current} onClose={()=>setOpen(false)}
      items={choices.map(([id, label, Symbol]) => ({id,label,icon:<Symbol/>,checked:id===theme,onSelect:()=>setTheme(id)}))}/>}
  </>;
}
