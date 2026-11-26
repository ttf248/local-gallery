import {act,render,screen} from "@testing-library/react";
import {expect,it} from "vitest";
import {PageToolbar} from "./PageToolbar";
it("离开哨兵后标记吸顶并维护滚动容器偏移",()=>{
 const {unmount}=render(<main className="app-main"><PageToolbar label="照片工具" start={<button>选择</button>}/></main>);
 const main=screen.getByRole("main"),bar=screen.getByRole("toolbar").parentElement!;
 act(()=>{(globalThis as unknown as {triggerIntersection:(el:Element,v:boolean)=>void}).triggerIntersection(main.firstElementChild!,false);});
 expect(bar).toHaveAttribute("data-stuck","true");expect(main.style.getPropertyValue("--sticky-offset")).toContain("--topbar-h");
 unmount();expect(main.style.getPropertyValue("--sticky-offset")).toBe("");
});
