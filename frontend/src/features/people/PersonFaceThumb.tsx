import { useState } from "react";
import type { PersonGroup } from "../../api/aiJobs";
import { personFaceCrop } from "../../utils/personFaceCrop";
import { RenditionImage } from "../common";
import { PeopleIcon } from "../../ui/icons";

interface Props {
  person: PersonGroup;
  /** 方块边长（CSS 像素）。 */
  size?: number;
  /**
   * 撑满外层容器。
   *
   * 卡片里的代表脸由外层那块方框决定大小：脸的裁切框是按正方形算的
   * （宽高用同一个比例换算），容器一变形脸就被拉长了。
   */
  fill?: boolean;
  className?: string;
  testId?: string;
}

/**
 * 人物预览的头像。
 *
 * 优先露出**脸本身**：分组的封面照片常是一张合影，脸只占画面里一小块，
 * 整张当缩略图时用户认不出是哪个人。服务端给出代表脸的框与原图尺寸，
 * 这里据此把脸放到方块中央。
 *
 * 尺寸读不出来（老索引、没有框）时退回整张封面 —— 那也比空着强。
 * 连封面都没有时给一枚人物图标：一块空方框会被读成「图片没加载出来」。
 */
export default function PersonFaceThumb({
  person,
  size = 64,
  fill = false,
  className = "",
  testId,
}: Props) {
  const face = person.coverFace;
  const [failedUrl, setFailedUrl] = useState<string>();
  const [rotatedResource, setRotatedResource] = useState<string>();
  const rotated = rotatedResource === face?.resourceId;
  const crop = face
    ? personFaceCrop(
        face.box,
        rotated ? face.height : face.width,
        rotated ? face.width : face.height,
        size,
      )
    : null;
  const resourceId = crop ? face?.resourceId : person.coverResourceId;

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-sunken ${
        fill ? "h-full w-full " : ""
      }${className}`}
      style={
        fill ? { width: "100%", height: "100%" } : { width: size, height: size }
      }
      data-testid={testId ? `${testId}-frame` : undefined}
    >
      {person.portraitUrl && failedUrl !== person.portraitUrl ? (
        <img
          onError={() => setFailedUrl(person.portraitUrl)}
          src={person.portraitUrl}
          srcSet={`${person.portraitUrl}&w=320 2x`}
          loading="lazy"
          decoding="async"
          alt=""
          className="h-full w-full object-cover"
          data-testid={testId}
        />
      ) : resourceId && !person.portraitUrl ? (
        <RenditionImage
          fileId={resourceId}
          alt=""
          displayWidth={crop?.displayWidth ?? size}
          className={crop ? "block" : "h-full w-full object-cover"}
          style={crop?.style}
          onLoad={({ currentTarget }) => {
            if (!face || !crop) return;
            // 人脸框在转正的照片上，旧记录的尺寸可能取自旋转前的文件头。
            const portrait =
              currentTarget.naturalHeight > currentTarget.naturalWidth;
            setRotatedResource(
              portrait !== face.height > face.width ? resourceId : undefined,
            );
          }}
          testId={testId}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-ink-3">
          <PeopleIcon size={20} />
        </span>
      )}
    </div>
  );
}
