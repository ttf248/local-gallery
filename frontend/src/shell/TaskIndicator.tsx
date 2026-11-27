import { settingsRoute } from "../utils/path";
import {Link} from "react-router-dom";
import {ProgressRing} from "../ui/ProgressRing";
import {ProgressBar} from "../ui/ProgressBar";
import {StatusDot} from "../ui/StatusDot";
import type {ActiveJobSummary} from "../features/tasks/useActiveJobSummary";
export function TaskIndicator({summary,collapsed}:{summary:ActiveJobSummary|null;collapsed:boolean}){
 if(!summary || summary.status==="idle")return null;
 const percent=summary.progress===null?null:Math.round(summary.progress*100);
 return <Link to={settingsRoute("tasks")} aria-label={summary.label+(summary.status==="failed"?"，重试":"")} className="block rounded-lg bg-sunken p-3 hover:bg-hover">
  {collapsed?<ProgressRing value={percent} size={24} label={summary.label}/>:<>
   <StatusDot status={summary.status} label={summary.label}/>
   {summary.status==="failed"?<div className="mt-1 text-caption text-ink-2">上次失败 · 重试</div>:<div className="mt-2 flex items-center gap-2"><ProgressBar className="h-0.5 flex-1" value={summary.progress ?? undefined} label="任务进度"/><span className="text-caption text-ink-2">{percent===null?"进行中":percent+"%"}</span></div>}
  </>}
 </Link>;
}
