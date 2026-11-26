import {expect,it} from "vitest";
import {useUIStore} from "./uiStore";
it("升级 v2 保留有效偏好和目录抽屉，忽略未知字段",async()=>{
 const state={theme:"dark",viewMode:"list",sidebarCollapsed:true,showPersonFaceBoxes:true,folderDrawerOpen:true};
 localStorage.setItem("local-gallery-ui",JSON.stringify({state:{...state,unknown:true},version:2}));
 await useUIStore.persist.rehydrate();expect(useUIStore.getState()).toMatchObject({...state,memoriesDismissedOn:null});
 expect(JSON.parse(localStorage.getItem("local-gallery-ui")!)).toEqual({version:3,state:{...state,memoriesDismissedOn:null}});
});
it.each([null,"bad",0])("损坏的旧数据恢复默认偏好",async state=>{
 localStorage.setItem("local-gallery-ui",JSON.stringify({state,version:2}));await useUIStore.persist.rehydrate();
 expect(useUIStore.getState()).toMatchObject({theme:"system",viewMode:"grid",sidebarCollapsed:false,folderDrawerOpen:false,showPersonFaceBoxes:false,memoriesDismissedOn:null});
});
