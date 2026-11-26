import {useQuery} from "@tanstack/react-query";
import {aiJobsApi,type AIJobSnapshot} from "../../api/aiJobs";
import {jobProgressPercent,taskModuleLabel} from "../../utils/taskFormat";
export interface ActiveJobSummary {status:"running"|"paused"|"failed"|"idle";label:string;progress:number|null;failedCount:number}
export function activeJobSummary(snapshot?:AIJobSnapshot):ActiveJobSummary|null {
 if(!snapshot)return null;
 const active=snapshot.active ?? snapshot.jobs.find(job=>job.status==="running" || job.status==="paused");
 const recent=snapshot.jobs[0];
 const job=active ?? (recent?.status==="failed"?recent:undefined);
 if(!job || (job.status!=="running" && job.status!=="paused" && job.status!=="failed"))return null;
 const prefix={running:"正在分析",paused:"已暂停",failed:"上次失败"}[job.status];
 return {status:job.status,label:prefix+" · "+taskModuleLabel(job.type),progress:job.planned?jobProgressPercent(job)/100:null,failedCount:job.failed};
}
export function useActiveJobSummary(){
 const query=useQuery({queryKey:["ai-jobs"],queryFn:aiJobsApi.list,staleTime:15000,refetchInterval:q=>q.state.data?.snapshot.active?15000:60000});
 return query.isError?null:activeJobSummary(query.data?.snapshot);
}
