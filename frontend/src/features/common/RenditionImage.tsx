import type { CSSProperties, ReactEventHandler } from "react";
import { thumbSrcSet, thumbUrl } from "../../api/thumbs";
import { pickRenditionWidth, renditionCandidates } from "../../utils/rendition";

interface Props {
  /** 文件资源 ID（f_xxx）。 */
  fileId: string;
  /** 媒体内容版本号；带上之后服务端可回 immutable，浏览器长期缓存。 */
  version?: string;
  alt: string;
  /**
   * 槽位的显示宽度（CSS 像素）。
   *
   * 渲染图按宽度分档：小槽位拿小档、大槽位拿大档，两边都不浪费。
   * sizes 用它告诉浏览器这个槽位有多宽，浏览器据此在候选里挑一档。
   */
  displayWidth: number;
  /**
   * 覆盖 sizes 描述符。
   *
   * 槽位宽度由 CSS 决定（而不是 JS 量出来）时用它：浏览器据此在候选
   * 里挑档，displayWidth 只作为 src 的兜底。
   */
  sizes?: string;
  /** 透传到 img 的 data-testid：测试与样式定位用。 */
  testId?: string;
  className?: string;
  loading?: "lazy" | "eager";
  style?: CSSProperties;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  onError?: () => void;
}

/**
 * 按槽位宽度取渲染图的图片。
 *
 * 所有媒体图片都走这一个入口：渲染档位、srcset 候选与版本化 URL 的
 * 规则只有一份，散在各处迟早会出现某个页面忘了传版本号、于是每次
 * 打开都要重新校验的漏网之鱼。
 */
export default function RenditionImage({
  fileId,
  version,
  alt,
  displayWidth,
  sizes,
  testId,
  className,
  loading = "lazy",
  style,
  onLoad,
  onError,
}: Props) {
  return (
    <img
      src={thumbUrl(fileId, version, pickRenditionWidth(displayWidth))}
      srcSet={thumbSrcSet(fileId, version, renditionCandidates())}
      sizes={sizes ?? `${displayWidth}px`}
      alt={alt}
      loading={loading}
      decoding="async"
      onLoad={onLoad}
      onError={onError}
      className={className}
      style={style}
      data-testid={testId}
    />
  );
}
