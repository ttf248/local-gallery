import {useQuery} from "@tanstack/react-query";
import {libraryApi,type LibraryFeedItem,type TimelineYear} from "../../api/library";
import {RenditionImage} from "../common";
import { ExploreSection, PreviewSkeleton } from "./ExploreSection";
import { ScrollRow } from "../../ui/ScrollRow";
import { useMemo,useRef,useEffect,useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaFeed } from "../../hooks/useMediaFeed";
import { InlineAlert } from "../../ui/InlineAlert";

export default function YearRibbon() {
  const navigate = useNavigate();
  const query = useMediaFeed(
    useMemo(() => ({ kind: "photo" as const, scope: "timeline" as const }), []),
  );

  return (
    <ExploreSection
      id="explore-time"
      title="时间"
      to={"/photo"}
      linkLabel="时间线"
    >
      {query.isError ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        >
          年份索引暂时读不出来。
        </InlineAlert>
      ) : query.isPending ? (
        <PreviewSkeleton label="正在读取年份索引…" shape="year" />
      ) : query.years.length > 0 ? (
        <ScrollRow
          label="按年份浏览"
          gap={12}
          data-testid="year-timeline"
          style={{ maskImage: "none" }}
        >
          {query.years.map(year=><YearCard key={year.year} year={year} initial={query.items?.find(item=>item.kind==="image" && item.dateValue?.startsWith(String(year.year)))} onOpen={()=>navigate("/photo?year="+year.year)}/>)}
        </ScrollRow>
      ) : (
        <p className="text-body text-ink-2">
          目前没有带日期证据的年份。只有文件修改时间的媒体不会归入某一年，可在照片页的「日期未知」中查看。
        </p>
      )}
    </ExploreSection>
  );
}

function YearCard({year,initial,onOpen}:{year:TimelineYear; initial?:LibraryFeedItem;onOpen:()=>void}){
  const ref=useRef<HTMLButtonElement>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(!ref.current)return;
    if(typeof IntersectionObserver==="undefined"){setVisible(true);return;}
    const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect();}});
    observer.observe(ref.current);return ()=>observer.disconnect();
  },[]);
  const cover=useQuery({
    queryKey:["library","year-cover",year.year,year.count],enabled:visible && !initial,staleTime:60000,
    queryFn:({signal})=>libraryApi.mediaFeed({kind:"photo",scope:"timeline",year:String(year.year),media:"photo"},undefined,signal,1).then(result=>result.page.items[0] ?? null),
  });
  const image=initial ?? cover.data;
  return <button ref={ref} className="relative h-[88px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-media text-left" onClick={onOpen}>
    {image && <RenditionImage fileId={image.id} version={image.version} displayWidth={120} alt="" className="size-full object-cover"/>}
    <span className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 to-transparent p-2 text-white">
      <span className="flex items-center gap-2 text-subheading">{year.year}{year.year===new Date().getFullYear() && <i aria-label="今年" className="size-1.5 rounded-full bg-accent"/>}</span>
      <span className="text-caption">{year.count.toLocaleString("zh-CN")} 张</span>
    </span>
  </button>;
}
