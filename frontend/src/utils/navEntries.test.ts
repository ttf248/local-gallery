import {expect,it} from "vitest";
import {mobileTabsFor,moreEntriesFor,isNavEntryActive,PHOTO_NAV,COMIC_NAV,MACHINE_GROUP} from "./navEntries";
it("两侧底栏依偏好显示，首页固定，本机操作属于更多",()=>{
 for(const mode of ["photo","comic"] as const){const all=mobileTabsFor(mode,()=>true);expect(all).toHaveLength(4);expect(mobileTabsFor(mode,()=>false)).toEqual([all[0]]);
 expect(mobileTabsFor(mode,key=>key!==all[1].key)).toEqual([all[0],all[2],all[3]]);
 const more=moreEntriesFor(mode,()=>true);expect(more).toEqual([...(mode==="photo"?[PHOTO_NAV[4]]:[]),...MACHINE_GROUP.entries]);}
});
it.each([["/photo","photo.home"],["/comic","comic.home"],["/comic/library","comic.library"],["/comic/albums/x","comic.library"],["/photo/albums/x","photo.library"],["/photo/people/x","photo.explore"],["/photo/travels/place/a","photo.explore"],["/photo/smart-albums","photo.explore"],["/photo/semantic","photo.explore"],["/photo/me/picks","photo.me"],["/comic/unread","comic.unread"],["/photo/similarity","photo.organize"],["/settings/server","machine.settings"],["/tasks/run","machine.tasks"]])("%s 只有一个归属", (path,key)=>{
 expect([...PHOTO_NAV,...COMIC_NAV,...MACHINE_GROUP.entries].filter(entry=>isNavEntryActive(entry,path,path.startsWith("/comic")?"comic":"photo")).map(entry=>entry.key)).toEqual([key]);
});
