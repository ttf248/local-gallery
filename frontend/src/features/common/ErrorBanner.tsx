import type { MouseEvent, ReactNode } from "react";

interface Props {
  /** 这句话说的是什么坏了。 */
  children: ReactNode;
  /**
   * 失败之后能做什么：给出重试的手柄。
   *
   * 拿到点击事件是为了在重试时把焦点挪到别处 —— 重试会暂时移除这条提示，
   * 焦点落在刚消失的按钮上就没了。
   */
  onRetry?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** 正在重试：按钮禁用，并换一句「正在重试…」。 */
  retrying?: boolean;
  /** 重试按钮的措辞。 */
  retryLabel?: string;
  /**
   * 语气。
   *
   * danger 是「这件事没成」；warning 是「还能用，但有一件没成」——
   * 例如后续分页取失败，已加载的内容仍然能翻。
   */
  kind?: "danger" | "warning";
  /** 这一处的版面（离上边多远、要不要占满整幅）。 */
  className?: string;
}

/**
 * 一处失败的提示。
 *
 * 读不出来的东西，前端各处原本各写一种：圆角有 md 有 lg 有 xl，底色有
 * 危险色有普通底，文字有 meta 有 body，失败后的手柄有叫「重试加载」的
 * 有叫「重新加载」的。一处失败在界面上却长得不一样，用户得先认一遍
 * 「这是不是出错了」才敢点那个手柄。
 */
export default function ErrorBanner({
  children,
  onRetry,
  retrying,
  retryLabel,
  kind = "danger",
  className,
}: Props) {
  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-body ${
        kind === "warning"
          ? "border-warning/30 bg-warning/5"
          : "border-danger/30 bg-danger/5"
      } ${className ?? ""}`}
    >
      <p className="min-w-0">{children}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center min-h-8 shrink-0 text-primary hover:underline disabled:opacity-50"
        >
          {retrying ? "正在重试…" : (retryLabel ?? "重试加载")}
        </button>
      )}
    </div>
  );
}
