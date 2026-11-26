import {expect,it,vi} from "vitest";
import {fireEvent,render,screen,within,waitFor} from "@testing-library/react";
import {ConfirmProvider,useConfirm} from "./ConfirmDialog";
function Caller({result}:{result:(value:boolean)=>void}) {
  const confirm=useConfirm();
  return <button onClick={()=>void confirm({title:"删除记录",description:"原始文件会保留",confirmLabel:"删除",tone:"danger"}).then(result)}>打开确认框</button>;
}
it("取消与 Esc 拒绝、确认接受，关闭后归还焦点",async()=>{
  const result=vi.fn();render(<ConfirmProvider><Caller result={result}/></ConfirmProvider>);
  const trigger=screen.getByRole("button",{name:"打开确认框"});trigger.focus();
  for(const choice of ["取消","Escape","删除"]){
    fireEvent.click(trigger);const dialog=await screen.findByRole("dialog",{name:"删除记录"});
    expect(within(dialog).getByRole("button",{name:"取消"})).toHaveFocus();
    if(choice==="Escape")fireEvent.keyDown(dialog,{key:"Escape"});
    else fireEvent.click(within(dialog).getByRole("button",{name:choice}));
    await waitFor(()=>expect(result).toHaveBeenLastCalledWith(choice==="删除"));
    expect(trigger).toHaveFocus();
  }
});
