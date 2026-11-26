import type { ReactNode } from "react";
import { PageChromeProvider } from "../src/shell/PageChrome";
import { CanvasTopBar } from "../src/shell/CanvasTopBar";

const noop = () => {};

export function WithTopBar({ children }: { children: ReactNode }) {
  return (
    <PageChromeProvider>
      <CanvasTopBar
        scrolled={false}
        onSearch={noop}
        onHelp={noop}
        onRefresh={noop}
        onScan={noop}
        onShuffle={noop}
        canScan
        shufflePending={false}
      />
      {children}
    </PageChromeProvider>
  );
}
