import { lazy,Suspense,createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
const ConfirmSurface=lazy(()=>import("./ConfirmSurface"));

export interface ConfirmOptions {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
}
type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm>(async () => false);
export function useConfirm(): Confirm {
  return useContext(ConfirmContext);
}
export function ConfirmProvider({children}: {children:ReactNode}) {
  const [options,setOptions] = useState<ConfirmOptions|null>(null);
  const resolve = useRef<((value:boolean)=>void)|null>(null);
  const confirm = useCallback<Confirm>(next => new Promise(done => {
    resolve.current?.(false);
    resolve.current=done;
    setOptions(next);
  }),[]);
  const finish = (value:boolean) => {
    const done=resolve.current;
    resolve.current=null;
    setOptions(null);
    done?.(value);
  };
  useEffect(()=>()=>{resolve.current?.(false);resolve.current=null;},[]);
  return <ConfirmContext.Provider value={confirm}>{children}
    {options && <Suspense fallback={null}><ConfirmSurface options={options} finish={finish}/></Suspense>}

  </ConfirmContext.Provider>;
}
