import {useQuery} from "@tanstack/react-query";
import type {AppMode} from "../api/library";
import {similarityApi} from "../api/similarity";
import type {NavKey} from "../app/routeMeta";
import {useLibraryActivitySummary} from "../hooks/useLibrary";
import {similarityStatusKey} from "../hooks/useSimilarity";
export type NavBadges=Partial<Record<NavKey,number>>;
export function useNavBadges(mode:AppMode):NavBadges{
 const activity=useLibraryActivitySummary();
 const similarity=useQuery({queryKey:similarityStatusKey,queryFn:()=>similarityApi.status(),enabled:mode==="photo",staleTime:60000});
 if(mode==="comic"){const unread=activity.data?.summary.unreadCount;return !activity.isError && unread ? {"comic.unread":unread}:{};}
 const pending=similarity.data?.status?.summary?.pending;
 return !similarity.isError && pending ? {"photo.organize":pending}:{};
}
