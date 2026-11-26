import {useLayoutEffect,useRef,useState} from "react";
import {Toolbar,type ToolbarProps} from "../ui/Toolbar";
import {cx} from "../ui/cx";
export interface PageToolbarProps extends ToolbarProps {sticky?:boolean}
export function PageToolbar({sticky=true,className,...props}:PageToolbarProps){
 const sentinel=useRef<HTMLDivElement>(null),root=useRef<HTMLDivElement>(null);
 const [stuck,setStuck]=useState(false);
 useLayoutEffect(()=>{
   const marker=sentinel.current,bar=root.current,main=bar?.closest<HTMLElement>(".app-main");
   if(!sticky || !bar || !marker || !main)return;
   const observe=new IntersectionObserver(([entry])=>setStuck(!entry.isIntersecting && marker.getBoundingClientRect().top<=main.getBoundingClientRect().top),{root:main});
   observe.observe(marker);
   const update=()=>main.style.setProperty("--sticky-offset",`calc(var(--topbar-h) + ${bar.offsetHeight}px)`);
   update();const resize=typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);resize?.observe(bar);
   return ()=>{observe.disconnect();resize?.disconnect();main.style.removeProperty("--sticky-offset");};
 },[sticky]);
 return <><div ref={sentinel} aria-hidden="true" className="h-px"/><div ref={root} data-stuck={sticky && stuck} className={cx(sticky && "sticky top-0 z-toolbar",stuck && "border-b border-line-subtle bg-canvas/90 backdrop-blur-xl",className)}><Toolbar {...props}/></div></>;
}
