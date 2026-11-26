import "@testing-library/jest-dom";

// jsdom 还没实现原生 <dialog> 的模态方法：属性面板、帮助浮层、目录选择
// 与并排对比都用 <dialog> + showModal()，测试里得先补上这两个方法。
// 焦点循环与背景不可聚焦由浏览器用例验证，这里只补「开」与「关」。
if (typeof HTMLDialogElement !== "undefined") {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    },
    close(this: HTMLDialogElement) {
      this.open = false;
    },
  });
}

// jsdom 还没实现 IntersectionObserver：无限下拉靠它判断「快到底了」。
// 这里补一个最小实现：观察者记下来，用例要触发时自己调
// triggerIntersection(target)。
interface StubObserver {
  callback: IntersectionObserverCallback;
  targets: Set<Element>;
}

const stubObservers = new Set<StubObserver>();

class StubIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly record: StubObserver;

  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, targets: new Set() };
    stubObservers.add(this.record);
  }

  observe(target: Element) {
    this.record.targets.add(target);
  }

  unobserve(target: Element) {
    this.record.targets.delete(target);
  }

  disconnect() {
    stubObservers.delete(this.record);
    this.record.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver =
  StubIntersectionObserver as unknown as typeof IntersectionObserver;

// 手动触发一次相交：用例用它验证「滑到底会接上下一批」。
(globalThis as unknown as Record<string, unknown>).triggerIntersection = (
  target: Element,
  isIntersecting = true,
) => {
  for (const observer of stubObservers) {
    if (!observer.targets.has(target)) continue;
    observer.callback(
      [
        {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
        } as IntersectionObserverEntry,
      ],
      observer as unknown as IntersectionObserver,
    );
  }
};

// jsdom 缺少 Web Animations 与指针捕获。用例可替换 animate 并控制 finished。
if (!Element.prototype.animate) {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: () => ({
      finished: Promise.resolve(),
      cancel() {},
      finish() {},
    }),
  });
}
if (!Element.prototype.setPointerCapture) {
  const captured = new WeakMap<Element, Set<number>>();
  Object.assign(Element.prototype, {
    setPointerCapture(this: Element, id: number) {
      const ids = captured.get(this) ?? new Set<number>();
      ids.add(id);
      captured.set(this, ids);
    },
    releasePointerCapture(this: Element, id: number) {
      captured.get(this)?.delete(id);
    },
    hasPointerCapture(this: Element, id: number) {
      return captured.get(this)?.has(id) ?? false;
    },
  });
}
