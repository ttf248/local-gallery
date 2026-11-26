import AppRoutes from "./app/AppRoutes";
import AccessGate from "./shell/AccessGate";
import ErrorBoundary from "./features/common/ErrorBoundary";
import ToastViewport from "./features/common/Toast";
import { useSelectionScope } from "./store/selectionStore";
import { useTheme } from "./hooks/useTheme";
import { useAppModeHydration } from "./hooks/useAppMode";
import { useLibraryActivitySync } from "./hooks/useLibrary";
export default function App() {
  useSelectionScope();
  useTheme();
  // 工作台偏好来自服务端：先水合，根路径才知道该落到哪一侧。
  useAppModeHydration();
  useLibraryActivitySync();
  return (
    <AccessGate>
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
      <ToastViewport />
    </AccessGate>
  );
}
