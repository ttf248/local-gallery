import {expect,it} from "vitest";
import {useUIStore} from "./uiStore";
it("升级 v2 保留有效偏好和目录抽屉，忽略未知字段",async()=>{
 const state={theme:"dark",viewMode:"list",sidebarCollapsed:true,showPersonFaceBoxes:true,folderDrawerOpen:true};
 localStorage.setItem("local-gallery-ui",JSON.stringify({state:{...state,unknown:true},version:2}));
 await useUIStore.persist.rehydrate();expect(useUIStore.getState()).toMatchObject({theme:"dark",viewMode:"list",sidebar:"collapsed",inspectorOpen:false,showPersonFaceBoxes:true,folderDrawerOpen:true,memoriesDismissedOn:null});
 expect(JSON.parse(localStorage.getItem("local-gallery-ui")!)).toEqual({version:4,state:{theme:"dark",viewMode:"list",sidebar:"collapsed",inspectorOpen:false,showPersonFaceBoxes:true,folderDrawerOpen:true,memoriesDismissedOn:null}});
});
it.each([null,"bad",0])("损坏的旧数据恢复默认偏好",async state=>{
 localStorage.setItem("local-gallery-ui",JSON.stringify({state,version:2}));await useUIStore.persist.rehydrate();
 expect(useUIStore.getState()).toMatchObject({theme:"system",viewMode:"grid",sidebar:"expanded",inspectorOpen:false,folderDrawerOpen:false,showPersonFaceBoxes:false,memoriesDismissedOn:null});
});
