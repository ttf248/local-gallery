import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../api/queryClient";
import WorkbenchModeProvider from "../shell/WorkbenchModeProvider";

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <WorkbenchModeProvider>{children}</WorkbenchModeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
