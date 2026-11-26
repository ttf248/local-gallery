import type { LibraryMediaItem } from "../../api/library";
import { ContextMenu } from "../../ui/ContextMenu";
import type { MenuItem } from "../../ui/Menu";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  GridIcon,
  ImageIcon,
  InfoIcon,
  PickIcon,
  UncheckIcon,
} from "../../ui/icons";

interface Props {
  x: number;
  y: number;
  /** 菜单针对的那张照片。 */
  item: LibraryMediaItem;
  /** 这张照片是不是在精选里。 */
  picked: boolean;
  /** 能不能在文件管理器里打开。 */
  canOpenInExplorer: boolean;
  /** 关掉菜单。 */
  onClose: () => void;
  /** 选了一个动作。 */
  onSelect: (
    action:
      | "open"
      | "pick"
      | "cover"
      | "properties"
      | "copy"
      | "explorer"
      | "representative",
    item: LibraryMediaItem,
  ) => void;
}

/**
 * 照片墙上单张照片的右键菜单。
 *
 * 菜单项与动作都在这里定：页面只管把动作接到自己的处理器上，不用在
 * 渲染里散落一串 id 分支。
 */
export default function AlbumMediaMenu({
  x,
  y,
  item,
  picked,
  canOpenInExplorer,
  onClose,
  onSelect,
}: Props) {
  const items: (
    Omit<Extract<MenuItem, { id: string }>, "onSelect"> | { type: "separator" }
  )[] = [
    { id: "open", label: "查看大图", icon: <GridIcon size={12} /> },
    {
      id: "pick",
      label: picked ? "移出精选" : "加入精选",
      icon: picked ? <UncheckIcon size={12} /> : <CheckIcon size={12} />,
    },
    { id: "copy", label: "复制相册链接", icon: <CopyIcon size={12} /> },
    { id: "cover", label: "设为封面", icon: <ImageIcon size={12} /> },
    /* 换代表照片：只有属于某个相似组的照片才有这个动作。
       它是用户自己的决定，写进相似照片的人工决定里。 */
    ...(item.similarityGroup
      ? [
          {
            id: "representative",
            label: "设为相似组代表",
            icon: <PickIcon size={12} />,
          },
        ]
      : []),
    { type: "separator" },
    { id: "properties", label: "属性", icon: <InfoIcon size={12} /> },
    {
      id: "explorer",
      label: "在文件管理器中打开",
      icon: <ArrowUpRightIcon size={12} />,
      disabled: !canOpenInExplorer,
    },
  ];

  return (
    <ContextMenu
      x={x}
      y={y}
      items={items.map((action) =>
        "type" in action
          ? action
          : {
              ...action,
              onSelect: () =>
                onSelect(action.id as Parameters<Props["onSelect"]>[0], item),
            },
      )}
      onClose={onClose}
    />
  );
}
