import { useState } from "react";
import RenditionImage from "../common/RenditionImage";
import VideoCoverImage from "../common/VideoCoverImage";
import { FolderIcon } from "../common/Icon";
import type { CardData } from "./AlbumCard";

interface Props {
  data: Pick<
    CardData,
    | "coverKind"
    | "coverPath"
    | "covers"
    | "coverVersion"
    | "coverVersions"
    | "title"
    | "variant"
    | "contentKind"
  >;
  loading?: "lazy" | "eager";
  /**
   * 紧凑模式：列表视图的缩略图很小，放不下「正在加载…」这类提示文字，
   * 只保留转圈指示。
   */
  compact?: boolean;
  /**
   * 视频封面怎么放进画幅。
   *
   * "contain" 保留完整画面，但竖版书封里一条 16:9 的视频会在上下留出
   * 大片黑边，读起来像「缺图」；"cover" 铺满画幅，裁掉两侧，
   * 封面因此像一张海报而不是一个空信箱。
   */
  fit?: "contain" | "cover";
}

/** 一张封面图与它的内容版本号。 */
interface CoverSource {
  path: string;
  version?: string;
}

/**
 * 卡片封面的唯一渲染入口。
 *
 * 相册强调一个明确的主封面；集合与文件夹用一张主体照片配最多两张小图
 * （照片侧），漫画侧的作品仍用四等分拼贴。
 * `covers` 为空时继续使用 `coverPath`，让旧扫描结果也能得到完整封面。
 */
export default function CardCover({
  data,
  loading = "lazy",
  compact,
  fit = "contain",
}: Props) {
  const sources = getCoverSources(data);

  if (sources.length === 0) return <CoverPlaceholder />;

  if (data.variant === "album") {
    if (data.coverKind === "video") {
      return (
        // 视频画幅固定 16:9，容器可能是 4:5 —— 深色画布让上下留边
        // 读成"宽银幕"而不是"缺图"。竖版书封里留边太多，
        // 那种封面改用铺满（见 fit），裁掉两侧而不是留一整块空信箱。
        <div className="w-full h-full bg-bg-media">
          <VideoCoverImage
            key={sources[0].path}
            videoPath={sources[0].path}
            version={data.coverVersion}
            displayWidth={260}
            loading={loading}
            alt={data.title}
            showRetryAction={false}
            showExtractingHint={!compact}
            fit={fit}
          />
        </div>
      );
    }

    return (
      <CoverImage
        key={sources[0].path}
        path={sources[0].path}
        version={data.coverVersion}
        alt={data.title}
        loading={loading}
        /* 相册封面统一偏上取景：漫画封面的标题与人物头部在上方，
           居中裁切会把它们切掉；横向照片本身是横向裁切，不受影响。 */
        position="50% 25%"
      />
    );
  }

  // 漫画侧（书架）保留四等分拼贴：一本作品是竖版书脊，四张内页并排
  // 才读得出「这一本里有什么」。照片侧的文件夹改用主体 + 小图。
  const isComic = (data.contentKind ?? "photo") === "comic";
  if (!isComic) {
    // 列表视图的缩略图只有 48px 见方：那里放不下主体加小图，只摆
    // 一张（主体），三张小图挤在一起只会糊成一片。
    if (compact) {
      return (
        <CoverImage
          path={sources[0].path}
          version={sources[0].version}
          alt={data.title}
          loading={loading}
          displayWidth={96}
        />
      );
    }
    const [main, ...rest] = sources;
    return (
      <div className="cover-stack" data-testid="card-cover-stack">
        <CoverImage
          path={main.path}
          version={main.version}
          alt={data.title}
          loading={loading}
          displayWidth={260}
        />
        {rest.length > 0 ? (
          <div className="cover-stack__side" data-covers={Math.min(rest.length, 2)}>
            {rest.slice(0, 2).map((source) => (
              <div key={source.path} className="cover-stack__cell">
                <CoverImage
                  path={source.path}
                  version={source.version}
                  alt=""
                  loading={loading}
                  displayWidth={90}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="cover-mosaic"
      data-cover-layout={
        sources.length === 1 ? "single" : `mosaic-${sources.length}`
      }
      data-testid="card-cover-mosaic"
    >
      {sources.map((source) => (
        <div
          key={source.path}
          className="cover-mosaic__cell min-w-0 min-h-0 overflow-hidden bg-bg-subtle"
        >
          <CoverImage
            path={source.path}
            version={source.version}
            alt=""
            loading={loading}
            displayWidth={130}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * 封面来源与它们的版本号。
 *
 * 版本号跟着图一起取：去重之后下标会变，按下标去取版本号会取错 ——
 * 同一张图配着另一张的版本，封面就会显示成旧的那一张。
 */
function getCoverSources(
  data: Pick<
    CardData,
    "coverPath" | "coverVersion" | "covers" | "coverVersions" | "variant"
  >,
): CoverSource[] {
  if (data.variant === "album") {
    return data.coverPath
      ? [{ path: data.coverPath, version: data.coverVersion }]
      : [];
  }

  const seen = new Set<string>();
  const list: CoverSource[] = [];
  const covers = data.covers ?? [];
  for (let index = 0; index < covers.length && list.length < 4; index += 1) {
    const path = covers[index].trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    list.push({ path, version: data.coverVersions?.[index] });
  }

  if (list.length > 0) return list;
  return data.coverPath ? [{ path: data.coverPath, version: data.coverVersion }] : [];
}

function CoverImage({
  path,
  version,
  alt,
  loading,
  position = "50% 50%",
  displayWidth = 260,
}: {
  path: string;
  version?: string;
  alt: string;
  loading: "lazy" | "eager";
  position?: string;
  displayWidth?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <CoverPlaceholder />;

  return (
    <RenditionImage
      fileId={path}
      version={version}
      alt={alt}
      displayWidth={displayWidth}
      loading={loading}
      onError={() => setFailed(true)}
      style={{ objectPosition: position }}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] group-active:scale-[1.03]"
    />
  );
}

function CoverPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-bg-subtle text-fg-subtle">
      <FolderIcon size={28} />
    </div>
  );
}
