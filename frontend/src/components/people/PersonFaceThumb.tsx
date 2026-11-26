import type { PersonGroup } from "../../api/aiJobs";
import { personFaceCropStyle } from "../../utils/personFaceCrop";
import RenditionImage from "../../features/common/RenditionImage";
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
  const crop = face
    ? personFaceCropStyle(face.box, face.width, face.height)
    : null;
  const resourceId = crop ? face?.resourceId : person.coverResourceId;

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-bg-subtle ${
        fill ? "h-full w-full " : ""
      }${className}`}
      style={
        fill
          ? { width: "100%", height: "100%" }
          : { width: size, height: size }
      }
      data-testid={testId ? `${testId}-frame` : undefined}
    >
      {resourceId ? (
        <RenditionImage
          fileId={resourceId}
          alt=""
          displayWidth={fill ? 360 : Math.round(size * 2)}
          className={crop ? "block" : "h-full w-full object-cover"}
          style={crop ?? undefined}
          testId={testId}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-fg-subtle">
          <PeopleIcon size={20} />
        </span>
      )}
    </div>
  );
}
