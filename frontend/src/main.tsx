import "@fontsource-variable/inter/wght.css";
import React from "react";
import ReactDOM from "react-dom/client";
import AppProviders from "./app/AppProviders";
import ErrorBoundary from "./features/common/ErrorBoundary";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";

// #root 一定存在（index.html 里写死了），但这里不赌：createRoot(null)
// 抛出的错没有上下文，用户只看到一片空白。
const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到挂载点 #root");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    {/* 最外层的错误边界：App 内部的那个只兜住路由区域，
        访问门禁、主题水合、工作台上下文都在它之外 ——
        它们任何一个抛错，整页就只剩白屏。这里给整个应用兜一层。 */}
    <ErrorBoundary title="应用起不来了">
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </React.StrictMode>,
);
