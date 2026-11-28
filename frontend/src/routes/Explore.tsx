import { settingsRoute } from "../utils/path";
import {buttonStyles} from "../ui/buttonStyles";
import { Link } from "react-router-dom";
import {useCallback,useState} from "react";
import { PageHero } from "../shell/PageHero";
import {SearchField} from "../ui/SearchField";
import Segmented from "../ui/Segmented";
import {useUIStore} from "../store/uiStore";
import { EmptyState } from "../ui/EmptyState";
import ErrorBanner from "../features/common/ErrorBanner";
import YearRibbon from "../features/explore/YearRibbon";
import PeopleRow from "../features/explore/PeopleRow";
import PlaceCards from "../features/explore/PlaceCards";
import ThemeCards from "../features/explore/ThemeCards";
import { useLibraryManifest } from "../hooks/useLibrary";
import { Page } from "../shell/Page";

export default function Explore() {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const photoAlbumCount = manifest?.statistics.photoAlbumCount ?? 0;
  const comicAlbumCount = manifest?.statistics.comicAlbumCount ?? 0;

  const [missing,setMissing]=useState<Record<string,boolean>>({});
  const reportEmpty=useCallback((key:string,value:boolean)=>setMissing(old=>old[key]===value?old:{...old,[key]:value}),[]);
  const combined=Object.values(missing).filter(Boolean).length>=2;
  const [scope,setScope]=useState<"name"|"content">("name");
  const open=(seed="")=>useUIStore.getState().setCommandPaletteOpen(true,scope,seed);
  return (
    <Page
      className="min-h-full pb-12"
    >
      <PageHero title="发现"/>
      <SearchField size="lg" value="" readOnly aria-label="搜索照片库" placeholder="搜索相册、画面与文字" aria-haspopup="dialog"
        onValueChange={()=>{}} onClick={()=>open()} onKeyDown={event=>{if(event.key==="Enter" || (event.key.length===1 && !event.altKey && !event.ctrlKey && !event.metaKey)){event.preventDefault();open(event.key==="Enter"?"":event.key);}}}
        trailing={<Segmented compact label="搜索范围" value={scope} onChange={setScope} options={[{value:"name",label:"名称"},{value:"content",label:"画面与文字"}]}/>}
      />
      {manifestQuery.isLoading && !manifest ? (
        <section
          className="page-section pt-section"
          aria-live="polite"
        >
          <p className="text-body text-ink-2">正在读取照片库信息…</p>
        </section>
      ) : null}

      {manifestQuery.isError && !manifest ? (
        <section className="page-section pt-section">
          <ErrorBanner
            onRetry={() => void manifestQuery.refetch()}
            retrying={manifestQuery.isFetching}
          >
            照片库信息暂时读不出来。
          </ErrorBanner>
        </section>
      ) : null}

      {manifest && manifestQuery.isError ? (
        <section className="pt-4">
          <ErrorBanner
            onRetry={() => void manifestQuery.refetch()}
            retrying={manifestQuery.isFetching}
          >
            照片库信息更新失败，下面仍显示上次读取到的内容。
          </ErrorBanner>
        </section>
      ) : null}

      {manifest && photoAlbumCount === 0 ? (
        <section className="page-section pt-section">
          <EmptyState
            title="照片库还没有相册"
            description={
              comicAlbumCount > 0
                ? "当前媒体库只有漫画相册。照片的发现结果只统计照片目录；可以切换到漫画工作台继续阅读。"
                : "先添加照片目录并完成扫描，这里才会出现时间、人物、地点和主题。"
            }
            icon={<span aria-hidden="true">▧</span>}
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                {comicAlbumCount > 0 ? (
                  <Link className={buttonStyles({variant:"secondary"})} to="/comic">
                    去漫画库看看
                  </Link>
                ) : null}
                <Link className={buttonStyles({variant:"primary"})} to={settingsRoute("server")}>
                  设置照片目录
                </Link>
              </div>
            }
          />
        </section>
      ) : null}

      {manifest && photoAlbumCount > 0 ? (
        <div className="mt-4 grid grid-cols-12 items-start gap-4">
          {combined&&<div className="col-span-full flex flex-wrap items-center gap-3 rounded-xl bg-sunken p-3 text-label">开启智能整理，按人物、地点与主题自动归类<Link className={buttonStyles({variant:"secondary",size:"sm"})} to={settingsRoute("tasks")}>前往任务中心</Link></div>}
          <PeopleRow report={reportEmpty} combined={combined}/>
          <PlaceCards report={reportEmpty} combined={combined}/>
          <YearRibbon />
          <ThemeCards report={reportEmpty} combined={combined}/>
        </div>
      ) : null}
    </Page>
  );
}
