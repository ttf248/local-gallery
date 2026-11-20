import type { PersonGroup } from "../../api/aiJobs";
import { personFaceCropStyle } from "../../utils/personFaceCrop";
import RenditionImage from "../common/RenditionImage";

interface Props {
  person: PersonGroup;
  /** 方块边长（CSS 像素）。 */
  size?: number;
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
 */
export default function PersonFaceThumb({
  person,
  size = 64,
  className = "",
  testId,
}: Props) {
  const face = person.coverFace;
  const crop = face
    ? personFaceCropStyle(face.box, face.width, face.height)
    : null;
  const resourceId = crop ? face?.resourceId : person.coverResourceId;

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-bg-subtle ${className}`}
      style={{ width: size, height: size }}
      data-testid={testId ? `${testId}-frame` : undefined}
    >
      {resourceId ? (
        <RenditionImage
          fileId={resourceId}
          alt=""
          displayWidth={Math.round(size * 2)}
          className={crop ? "block" : "h-full w-full object-cover"}
          style={crop ?? undefined}
          testId={testId}
        />
      ) : null}
    </div>
  );
}
