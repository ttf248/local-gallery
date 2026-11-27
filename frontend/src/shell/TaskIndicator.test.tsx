import {render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {expect,it} from "vitest";
import {TaskIndicator} from "./TaskIndicator";
it("空闲隐藏，运行进度和失败入口可读",()=>{
 const renderItem=(summary:Parameters<typeof TaskIndicator>[0]["summary"],collapsed=false)=><MemoryRouter><TaskIndicator summary={summary} collapsed={collapsed}/></MemoryRouter>;
 const {rerender}=render(renderItem(null));
 expect(screen.queryByRole("link")).toBeNull();
 rerender(renderItem({status:"running",label:"正在分析 · 人脸",progress:.62,failedCount:0},true));
 expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow","62");
 rerender(renderItem({status:"failed",label:"人脸分析",progress:null,failedCount:3}));
 expect(screen.getByRole("link",{name:/重试/})).toHaveAttribute("href","/settings/tasks");
});
