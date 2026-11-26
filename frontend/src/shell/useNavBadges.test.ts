import {renderHook} from "@testing-library/react";
import {describe,expect,it,vi} from "vitest";
import {useNavBadges} from "./useNavBadges";
const states=vi.hoisted(()=>({activity:{isError:false,data:{summary:{unreadCount:1240}}},similarity:{isError:false,data:{status:{summary:{pending:12}}}}}));
vi.mock("../hooks/useLibrary",()=>({useLibraryActivitySummary:()=>states.activity}));
vi.mock("@tanstack/react-query",async original=>({...await original<typeof import("@tanstack/react-query")>(),useQuery:()=>states.similarity}));
describe("侧栏读数",()=>{
 it("只返回当前工作台的计数",()=>{const hook=renderHook(({comic})=>useNavBadges(comic?"comic":"photo"),{initialProps:{comic:false}});expect(hook.result.current).toEqual({"photo.organize":12});hook.rerender({comic:true});expect(hook.result.current).toEqual({"comic.unread":1240});});
 it("读取失败不展示旧读数",()=>{states.similarity.isError=true;try{expect(renderHook(()=>useNavBadges("photo")).result.current).toEqual({});}finally{states.similarity.isError=false;}});
});
