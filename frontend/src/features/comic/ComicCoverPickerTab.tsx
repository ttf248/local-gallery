import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { libraryApi } from "../../api/library";
import { useAlbumMedia } from "../../hooks/useLibrary";
import { Button } from "../../ui/Button";
import { ThumbImage } from "../common";

export default function ComicCoverPickerTab({workId, firstId, busy, onPick}: {
  workId:string; firstId?:string; busy:boolean; onPick:(id:string)=>void;
}) {
  const [folders,setFolders]=useState([workId]);
  const [album,setAlbum]=useState(firstId ?? "");
  const parent=folders[folders.length-1];
  const chapters=useInfiniteQuery({
    queryKey:["library","cover-picker",parent],initialPageParam:undefined as string|undefined,
    queryFn:({pageParam,signal})=>libraryApi.childrenPage(parent,"comic",pageParam,200,signal),
    getNextPageParam:last=>last.page.nextCursor || undefined,
  });
  const nodes=chapters.data?.pages.flatMap(p=>p.page.items) ?? [];
  const selected=album || nodes.find(n=>n.kind==="album")?.id || "";
  const pages=useAlbumMedia(selected);
  return <section className="space-y-3">
    {folders.length>1 && <Button variant="ghost" onClick={()=>{setFolders(f=>f.slice(0,-1));setAlbum("");}}>上一级目录</Button>}
    <label className="grid gap-1 text-label">选择章节
      <select className="field w-full" value={selected} onChange={e=>{
        const target=nodes.find(n=>n.id===e.target.value);
        if(target?.kind==="collection"){setFolders(f=>[...f,target.id]);setAlbum("");}
        else setAlbum(e.target.value);
      }}>
        {!nodes.some(n=>n.id===selected) && <option value={selected}>{selected?"首篇":"选择章节"}</option>}
        {nodes.map(n=><option value={n.id} key={n.id}>{n.comic?.cleanTitle || n.displayName}{n.kind==="collection"?"（目录）":""}</option>)}
      </select>
    </label>
    {chapters.hasNextPage && <Button variant="secondary" disabled={chapters.isFetchingNextPage} onClick={()=>void chapters.fetchNextPage()}>更多章节</Button>}
    {chapters.isError && <Button variant="secondary" onClick={()=>void chapters.refetch()}>重试读取章节</Button>}
    {pages.isError && <Button variant="secondary" onClick={()=>void pages.refetch()}>重试读取页面</Button>}
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
    {pages.data?.pages.flatMap(p=>p.items).filter(p=>p.kind==="image").map((p,i)=><button type="button" key={p.id} disabled={busy} onClick={()=>onPick(p.id)} aria-label={`将第 ${i+1} 页设为总封面`} className="rounded-md text-caption focus-visible:ring-2">
      <ThumbImage className="aspect-[2/3] w-full rounded-md object-cover" fileId={p.id} version={p.version} alt=""/>{i+1}
    </button>)}</div>
    {pages.hasNextPage && <Button variant="secondary" disabled={pages.isFetchingNextPage} onClick={()=>void pages.fetchNextPage()}>更多页面</Button>}
  </section>;
}
