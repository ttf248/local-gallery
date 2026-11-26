import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type ReactElement,
} from "react";
export interface PageChromeConfig {
  title: string;
  backTo?: string | (() => string);
  actions?: ReactNode;
  search?: "global" | "none" | ReactElement;
}
type State = PageChromeConfig & { titleCollapsed: boolean };
const empty: State = { title: "", titleCollapsed: true };
function chromeRegistry() {
  const entries = new Map<number, State>(),
    listeners = new Set<() => void>();
  let current = empty,
    sequence = 0;
  const notify = () => {
    const key = Math.max(-1, ...entries.keys());
    const next = entries.get(key) ?? empty;
    if (next === current) return;
    current = next;
    listeners.forEach((fn) => fn());
  };
  return {
    allocate: () => ++sequence,
    set: (key: number, state: State) => {
      entries.set(key, state);
      notify();
    },
    remove: (key: number) => {
      entries.delete(key);
      notify();
    },
    read: () => current,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
const Context = createContext<ReturnType<typeof chromeRegistry> | null>(null);
export function PageChromeProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(chromeRegistry, []);
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}
const subscribeEmpty = () => () => {};
// eslint-disable-next-line react-refresh/only-export-components -- 同一个注册表公开页面与顶栏两端的 hook。
export function usePageChromeState() {
  const registry = useContext(Context);
  return useSyncExternalStore(
    registry?.subscribe ?? subscribeEmpty,
    registry?.read ?? (() => empty),
  );
}
// eslint-disable-next-line react-refresh/only-export-components -- 同一个注册表公开页面与顶栏两端的 hook。
export function usePageChrome({
  title,
  backTo,
  actions,
  search,
}: PageChromeConfig) {
  const registry = useContext(Context),
    key = useRef<number>();
  if (key.current === undefined && registry) key.current = registry.allocate();
  const [element, setElement] = useState<HTMLElement | null>(null),
    [visible, setVisible] = useState(true);
  const titleRef = useCallback((el: HTMLElement | null) => setElement(el), []);
  useLayoutEffect(() => {
    if (!element) return;
    setVisible(true);
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: element.closest("main") },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  useLayoutEffect(() => {
    if (key.current !== undefined)
      registry?.set(key.current, {
        title,
        backTo,
        actions,
        search,
        titleCollapsed: element === null || !visible,
      });
  }, [registry, title, backTo, actions, search, element, visible]);
  useLayoutEffect(() => {
    const id = key.current;
    return () => {
      if (id !== undefined) registry?.remove(id);
    };
  }, [registry]);
  return { titleRef };
}
