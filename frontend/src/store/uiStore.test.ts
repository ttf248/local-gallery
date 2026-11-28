import {expect,it} from "vitest";
import {useUIStore} from "./uiStore";
it("升级 v2 保留有效偏好和目录抽屉，忽略未知字段",async()=>{
 const state={theme:"dark",viewMode:"list",sidebarCollapsed:true,showPersonFaceBoxes:true,folderDrawerOpen:true};
 localStorage.setItem("local-gallery-ui",JSON.stringify({state:{...state,unknown:true},version:2}));
 await useUIStore.persist.rehydrate();expect(useUIStore.getState()).toMatchObject({theme:"dark",viewMode:"list",sidebar:"collapsed",inspectorOpen:false,showPersonFaceBoxes:true,folderDrawerOpen:true,memoriesDismissedOn:null});
 expect(JSON.parse(localStorage.getItem("local-gallery-ui")!)).toEqual({version:5,state:{memoriesCollapsed:false,theme:"dark",viewMode:"list",sidebar:"collapsed",inspectorOpen:false,showPersonFaceBoxes:true,folderDrawerOpen:true,memoriesDismissedOn:null}});
});
it("升级 v4 保留侧栏、信息面板、回忆隐藏日期，折叠默认关闭",async()=>{
localStorage.setItem("local-gallery-ui",JSON.stringify({version:4,state:{theme:"dark",sidebar:"collapsed",viewMode:"list",folderDrawerOpen:true,inspectorOpen:true,memoriesDismissedOn:"2026-11-28",showPersonFaceBoxes:true}}));await useUIStore.persist.rehydrate();expect(useUIStore.getState()).toMatchObject({sidebar:"collapsed",inspectorOpen:true,memoriesDismissedOn:"2026-11-28",memoriesCollapsed:false});useUIStore.getState().setMemoriesCollapsed(true);await useUIStore.persist.rehydrate();expect(useUIStore.getState().memoriesCollapsed).toBe(true)
});
it.each([null,"bad",0])("损坏的旧数据恢复默认偏好",async state=>{
 localStorage.setItem("local-gallery-ui",JSON.stringify({state,version:2}));await useUIStore.persist.rehydrate();
 expect(useUIStore.getState()).toMatchObject({theme:"system",viewMode:"grid",sidebar:"expanded",inspectorOpen:false,folderDrawerOpen:false,showPersonFaceBoxes:false,memoriesDismissedOn:null});
});
