import {render,screen,fireEvent} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
it("菜单仅列两个工作台，选择一次触发一次切换",()=>{
 const change=vi.fn();render(<WorkspaceSwitcher mode="photo" onChange={change}/>);
 fireEvent.click(screen.getByRole("button",{name:/切换工作台/}));
 expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
 expect(screen.getByRole("menuitemradio",{name:"照片"})).toHaveAttribute("aria-checked","true");
 fireEvent.click(screen.getByRole("menuitemradio",{name:"漫画"}));expect(change).toHaveBeenCalledTimes(1);expect(change).toHaveBeenCalledWith("comic");
});
