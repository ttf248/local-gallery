import type { ReactNode } from "react";
import { PageChromeProvider } from "../src/shell/PageChrome";
import { TopBar } from "../src/shell/TopBar";

const noop = () => {};

export function WithTopBar({ children }: { children: ReactNode }) {
  return (
    <PageChromeProvider>
      <TopBar
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
