import { useState } from "react";
import RenditionImage from "../common/RenditionImage";

interface Props {
  /** 文件资源 ID（f_xxx）；没有封面时显示占位。 */
  fileId?: string;
  /** 媒体内容版本号：带上之后浏览器可以长期缓存。 */
  version?: string;
  /**
   * 槽位的宽度（CSS 像素）：决定取哪一档渲染图。
   *
   * 槽位宽由 CSS 决定时用 sizes 覆盖，displayWidth 只当 src 的兜底。
   */
  displayWidth: number;
  /** 覆盖 sizes 描述符：槽位宽由 CSS 决定时用它。 */
  sizes?: string;
}

/**
 * 智能相册的封面：一张照片摆在方形的槽位里。
 *
 * 照片按原比例完整放进槽位，一个像素都不裁 —— 竖幅照片因此不会被切掉
 * 上下大半，主体不会被切成两半。照片没占满的地方，用同一张照片放大
 * 虚化铺满做底：底色取自照片本身，因此每张卡的颜色跟着内容走，整面墙
 * 不再是一格格灰底的文件列表。
 *
 * 两层用同一个 URL：浏览器只发一次请求、只解码一次，第二层多的只是一次
 * 绘制与一次模糊。
 */
export default function SmartAlbumCover({
  fileId,
  version,
  displayWidth,
  sizes,
}: Props) {
  const [failed, setFailed] = useState(false);

  if (!fileId || failed) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-bg-subtle text-meta text-fg-subtle"
        data-testid="smart-album-cover-empty"
      >
        暂无封面
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 底：同一张照片放大虚化，铺满槽位。
          放大到 1.35 是为了把模糊的透明边推出槽位 —— 模糊半径大于可见区
          与元素边的距离时，槽位四周会露出一圈暗角。16px 的模糊配 1.35 的
          放大刚好：暗角全在视野外，成本也低一档。 */}
      <RenditionImage
        fileId={fileId}
        version={version}
        alt=""
        displayWidth={displayWidth}
        sizes={sizes}
        className="absolute inset-0 h-full w-full scale-[1.35] object-cover blur-lg"
        testId="smart-album-cover-backdrop"
      />
      {/* 前景：照片本身。
          max-h-full/max-w-full 配 img 默认的宽高 auto，让元素盒恰好等于
          照片的渲染区，于是细边与投影贴在照片边缘，而不是贴在槽位边缘。
          object-contain 是兜底：万一某个引擎把盒算成槽位大小，照片也只是
          内缩留白，不会被拉变形。槽位留了 p-2 的余量，悬停放大也不会
          顶出槽位被裁掉。 */}
      <div className="absolute inset-0 flex items-center justify-center p-2">
        <RenditionImage
          fileId={fileId}
          version={version}
          alt=""
          displayWidth={displayWidth}
          sizes={sizes}
          className="max-h-full max-w-full rounded-sm object-contain shadow-md ring-1 ring-inset ring-border/50 transition-transform duration-300 group-hover:scale-[1.03]"
          testId="smart-album-cover-photo"
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}
