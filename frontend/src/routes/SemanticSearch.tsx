import {Page} from "../shell/Page";
import {buttonStyles} from "../ui/buttonStyles";
import { InlineAlert } from "../ui/InlineAlert";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { aiJobsApi, type SemanticSearchRequest } from "../api/aiJobs";
import { albumsApi, type SearchHit } from "../api/albums";
import type { LibraryFeedItem } from "../api/library";
import { PageHero } from "../shell/PageHero";
import { SearchIcon } from "../ui/icons";
import ContentSearchResults from "../features/search/ContentSearchResults";
import {
  useContentSearchQuery,
  type ContentSearchSubmission,
} from "../hooks/useContentSearchQuery";
import { useChinaPlacesAll } from "../hooks/useChinaLocations";
import Segmented from "../ui/Segmented";

type SearchMode = "text" | "image";

export default function SemanticSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const routeQuery = searchParams.get("q")?.trim() ?? "";
  const handledRoute = useRef<string | null>(null);
  const [submittedSemantic, setSubmittedSemantic] = useState(false);
  const [mode, setMode] = useState<SearchMode>("text");
  const [text, setText] = useState(routeQuery);
  const [imageOCRText, setImageOCRText] = useState("");
  const [imageFile, setImageFile] = useState<File | undefined>();
  const [similarResourceId, setSimilarResourceId] = useState("");
  const [albumText, setAlbumText] = useState("");
  const [album, setAlbum] = useState<Pick<SearchHit, "name" | "path">>();
  const [year, setYear] = useState("");
  const [adcode, setAdcode] = useState("");
  const [personId, setPersonId] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [pickedOnly, setPickedOnly] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitted, setSubmitted] = useState<ContentSearchSubmission | null>(
    null,
  );

  const statusQuery = useQuery({
    queryKey: ["ai-embedding-status"],
    queryFn: aiJobsApi.embeddingStatus,
    refetchInterval: 30_000,
  });
  // 地点筛选用行政区：坐标聚类的名字是「坐标 30.25°, 120.13°」，
  // 没法用来挑一个地方。
  // 地点清单走共享的 hook：键与足迹页的同一份查询一致，
  // 同一份数据不会因为键不同而被取两次。
  const provincePlacesQuery = useChinaPlacesAll("province", null, advancedOpen);
  const cityPlacesQuery = useChinaPlacesAll("city", null, advancedOpen);
  const provincePlaces = provincePlacesQuery.data ?? [];
  const cityPlaces = cityPlacesQuery.data ?? [];
  const peopleQuery = useQuery({
    enabled: advancedOpen,
    queryKey: ["people", false, "photos"],
    queryFn: () => aiJobsApi.people(false),
    staleTime: 60_000,
  });
  const albumQuery = useQuery({
    queryKey: ["semantic-album-filter", albumText],
    queryFn: () => albumsApi.search(albumText, "photo", 12),
    enabled: advancedOpen && !album && albumText.trim().length >= 2,
  });
  const status = statusQuery.data?.status;
  const embeddingReady = Boolean(status?.runtimeReady && status.modelValid);
  // 与结果区共用同一个查询键：这里看「还在搜吗」，那里看结果。
  const submittedQuery = useContentSearchQuery(submitted);
  const hasSemanticQuery =
    mode === "text"
      ? Boolean(text.trim() && embeddingReady)
      : Boolean(similarResourceId || imageFile);
  const hasOCRQuery =
    mode === "text" ? Boolean(text.trim()) : Boolean(imageOCRText.trim());
  const usesSemanticSearch =
    mode === "image" ? Boolean(similarResourceId || imageFile) : true;
  const hasSearchCondition = Boolean(
    hasSemanticQuery ||
    hasOCRQuery ||
    album ||
    year ||
    adcode ||
    personId ||
    favoriteOnly ||
    pickedOnly,
  );
  const advancedFilterCount =
    Number(Boolean(album)) +
    Number(Boolean(year.trim())) +
    Number(Boolean(adcode)) +
    Number(Boolean(personId)) +
    Number(favoriteOnly) +
    Number(pickedOnly);

  const submitRoute = useCallback((params: URLSearchParams, file?: File) => {
    const query = params.get("q")?.trim();
    const resourceId = params.get("resourceId");
    const ocrText = params.get("ocr") || query;
    const albumId = params.get("albumId");
    const year = params.get("year");
    const personId = params.get("personId");
    const adcode = Number(params.get("adcode"));
    const request: SemanticSearchRequest = {
      kind: "photo",
      ...(query && embeddingReady ? { text: query, matchMode: "any" } : {}),
      ...(ocrText ? { ocrText } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(albumId ? { albumId } : {}),
      ...(year ? { year } : {}),
      ...(personId ? { personId } : {}),
      ...(adcode ? { adcode } : {}),
      ...(params.get("favoriteOnly") === "1" ? { favoriteOnly: true } : {}),
      ...(params.get("pickedOnly") === "1" ? { pickedOnly: true } : {}),
    };
    setSubmittedSemantic(Boolean(query || resourceId || file));
    setSubmitted((Object.keys(request).length > 1 || file) &&
      (!params.has("upload") || file)
      ? { request, image: file, token: Date.now() }
      : null);
  }, [embeddingReady]);

  useEffect(() => {
    const key = searchParams.toString();
    if (handledRoute.current === key) return;
    if (routeQuery && !statusQuery.isSuccess && !statusQuery.isError) return;
    handledRoute.current = key;
    setText(routeQuery);
    setMode(searchParams.get("mode") === "image" ? "image" : "text");
    setImageFile(undefined);
    setSimilarResourceId(searchParams.get("resourceId") ?? "");
    setImageOCRText(searchParams.get("ocr") ?? "");
    const path = searchParams.get("albumId");
    setAlbum(path ? { path, name: searchParams.get("albumName") || path } : undefined);
    setAlbumText("");
    setYear(searchParams.get("year") ?? "");
    setAdcode(searchParams.get("adcode") ?? "");
    setPersonId(searchParams.get("personId") ?? "");
    setFavoriteOnly(searchParams.get("favoriteOnly") === "1");
    setPickedOnly(searchParams.get("pickedOnly") === "1");
    setAdvancedOpen(["albumId", "year", "adcode", "personId", "favoriteOnly", "pickedOnly"].some(k => searchParams.has(k)));
    submitRoute(searchParams);
  }, [searchParams, routeQuery, statusQuery.isSuccess, statusQuery.isError, submitRoute]);

  function search(resourceId?: string, file?: File) {
    const params = new URLSearchParams();
    if (mode === "image" || resourceId) {
      params.set("mode", "image");
      if (resourceId) params.set("resourceId", resourceId);
      if (file) params.set("upload", "1");
      if (mode === "image" && imageOCRText.trim()) params.set("ocr", imageOCRText.trim());
    } else if (text.trim()) params.set("q", text.trim());
    if (album) {
      params.set("albumId", album.path);
      params.set("albumName", album.name);
    }
    if (year) params.set("year", year);
    if (adcode) params.set("adcode", adcode);
    if (personId) params.set("personId", personId);
    if (favoriteOnly) params.set("favoriteOnly", "1");
    if (pickedOnly) params.set("pickedOnly", "1");
    handledRoute.current = params.toString();
    setSearchParams(params, { replace: params.toString() === searchParams.toString() });
    submitRoute(params, file);
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasSemanticQuery && !embeddingReady) return;
    search(mode === "image" ? similarResourceId || undefined : undefined,
      mode === "image" ? imageFile : undefined);
  };

  const findSimilar = (item: LibraryFeedItem) => {
    setMode("image");
    setImageFile(undefined);
    setSimilarResourceId(item.id);
    search(item.id);
  };

  const textHelp = embeddingReady
    ? "一个词同时检索画面语义与图片文字，任一匹配就会显示；文字会归一化标点、断行并修正常见误识。"
    : "Chinese-CLIP 不可用时仍可按图片文字搜索；OCR 会归一化标点、断行并修正常见误识。";

  // 提交按钮在文字搜索里与输入框同行，在以图搜图里另起一行 —— 两种
  // 模式都用同一枚按钮。
  const submitButton = (
    <button
      type="submit"
      disabled={
        submittedQuery.isFetching ||
        (hasSemanticQuery && !embeddingReady) ||
        !hasSearchCondition
      }
      className={buttonStyles({variant:"primary"})}
    >
      <SearchIcon size={14} />
      {submittedQuery.isFetching ? "搜索中…" : "搜索照片"}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 overflow-y-auto pb-4">
        <Page >
          <PageHero
            eyebrow="本地 AI · 组合检索"
            title="智能搜索"
            meta="同一个词自动查找画面内容与图片文字，也可附加相册、年份与地点条件。"
          />
        </Page>
        <Page as="section" className="mt-5">
          <form
            className="rounded-xl border border-line bg-raised p-4 shadow-1 sm:p-5"
            onSubmit={onSubmit}
          >
            {/* 检索框、搜索方式与提交按钮在同一行：输入框不必横跨整张
                卡片 —— 一千多像素宽的输入框为一个词准备了半个页面的空白；
                提交按钮也不再单独占一行。搜索方式用共享的分段控件，
                与主题切换、视图切换同一套语言。 */}
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label="搜索方式"
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  if (next === "text") setSimilarResourceId("");
                }}
                options={[
                  { value: "text", label: "文字搜索" },
                  { value: "image", label: "以图搜图" },
                ]}
              />
              {mode === "text" ? (
                /* 输入框与提交按钮是一组：窄屏上整组换到下一行，
                   输入框不会被挤成一个字的宽。 */
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
                  <div className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-line bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                    <label className="sr-only" htmlFor="semantic-search-query">
                      搜索内容
                    </label>
                    <input
                      id="semantic-search-query"
                      aria-label="搜索内容"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      maxLength={200}
                      placeholder="描述画面，或输入照片里的文字"
                      className="h-full min-w-0 flex-1 rounded-lg border-0 bg-transparent px-3 text-body text-ink outline-none placeholder:text-ink-3"
                    />
                  </div>
                  {submitButton}
                </div>
              ) : null}
            </div>

            {mode === "text" ? (
              <p className="mt-2 text-caption text-ink-3">{textHelp}</p>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-line-strong bg-sunken px-4 py-4">
                {similarResourceId ? (
                  <p className="text-body text-ink">
                    正在用当前照片查找相似图片。
                    <button
                      type="button"
                      className="ml-2 text-caption text-ink-2 underline underline-offset-2"
                      onClick={() => setSimilarResourceId("")}
                    >
                      改为上传图片
                    </button>
                  </p>
                ) : (
                  <label className="flex flex-wrap items-center gap-3 text-body text-ink">
                    <span className={buttonStyles({variant:"secondary",size:"sm"})}>选择图片</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(event) =>
                        setImageFile(event.target.files?.[0])
                      }
                    />
                    <span className="min-w-0 truncate text-caption text-ink-2">
                      {imageFile?.name ?? (searchParams.has("upload") ? "请重新选择用于搜索的图片" : "支持常见图片格式，单张不超过 64 MiB")}
                    </span>
                  </label>
                )}
                <label className="mt-4 block text-caption text-ink-2">
                  <span className="mb-1.5 block">图片文字筛选（可选）</span>
                  <input
                    value={imageOCRText}
                    onChange={(event) => setImageOCRText(event.target.value)}
                    maxLength={200}
                    placeholder="例如：照片里的招牌或日期"
                    className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink placeholder:text-ink-3"
                  />
                </label>
                <p className="mt-1.5 text-caption text-ink-3">
                  需先运行文字识别；不需要 Chinese-CLIP。
                </p>
                <div className="mt-4">{submitButton}</div>
              </div>
            )}

            <div className="mt-4">
              <button
                type="button"
                aria-expanded={advancedOpen}
                aria-controls="semantic-advanced-filters"
                onClick={() => setAdvancedOpen((open) => !open)}
                className="flex min-h-10 w-full items-center justify-between rounded-lg border border-line bg-sunken px-3 text-left text-caption font-medium text-ink hover:bg-sunken-strong sm:w-auto sm:min-w-64"
              >
                <span>高级筛选</span>
                <span className="flex items-center gap-2 text-ink-2">
                  {advancedFilterCount > 0
                    ? `${advancedFilterCount} 项已选择`
                    : "相册 · 年份 · 地点 · 人物"}
                  <span aria-hidden="true">{advancedOpen ? "−" : "+"}</span>
                </span>
              </button>
              {advancedOpen ? (
                <div
                  id="semantic-advanced-filters"
                  className="mt-3 rounded-lg border border-line bg-sunken/60 p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="min-w-0 text-caption text-ink-2">
                      <span className="mb-1.5 block">限定相册</span>
                      {album ? (
                        <button
                          type="button"
                          aria-label={`移除相册筛选，${album.name}`}
                          className="flex h-10 w-full items-center justify-between rounded-md border border-line bg-canvas px-3 text-left text-body text-ink"
                          onClick={() => {
                            setAlbum(undefined);
                            setAlbumText("");
                          }}
                        >
                          <span className="truncate">{album.name}</span>
                          <span
                            aria-hidden="true"
                            className="ml-2 text-ink-3"
                          >
                            ×
                          </span>
                        </button>
                      ) : (
                        <input
                          value={albumText}
                          onChange={(event) => setAlbumText(event.target.value)}
                          placeholder="输入相册名搜索"
                          className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink placeholder:text-ink-3"
                        />
                      )}
                      {!album &&
                        (albumQuery.data?.results ?? [])
                          .filter((hit) => hit.kind === "album")
                          .slice(0, 5)
                          .map((hit) => (
                            <button
                              key={hit.path}
                              aria-label={hit.name}
                              type="button"
                              className="mt-1 block w-full truncate rounded-md bg-raised px-3 py-2 text-left text-body text-ink hover:bg-sunken-strong"
                              onClick={() => {
                                setAlbum(hit);
                                setAlbumText("");
                              }}
                            >
                              {hit.name}
                            </button>
                          ))}
                    </label>
                    <label className="text-caption text-ink-2">
                      <span className="mb-1.5 block">拍摄年份</span>
                      <input
                        inputMode="numeric"
                        value={year}
                        onChange={(event) =>
                          setYear(
                            event.target.value.replace(/\D/g, "").slice(0, 4),
                          )
                        }
                        placeholder="例如 2024"
                        className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink placeholder:text-ink-3"
                      />
                    </label>
                    <label className="text-caption text-ink-2">
                      <span className="mb-1.5 block">拍摄地点</span>
                      <select
                        value={adcode}
                        onChange={(event) => setAdcode(event.target.value)}
                        className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink"
                      >
                        <option value="">所有地点</option>
                        {provincePlaces.length > 0 ? (
                          <optgroup label="省">
                            {provincePlaces.map((place) => (
                              <option key={place.adcode} value={place.adcode}>
                                {place.name} ·{" "}
                                {place.photoCount.toLocaleString()} 张
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {cityPlaces.length > 0 ? (
                          <optgroup label="市">
                            {cityPlaces.map((place) => (
                              <option key={place.adcode} value={place.adcode}>
                                {place.name} ·{" "}
                                {place.photoCount.toLocaleString()} 张
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                    </label>
                    <label className="text-caption text-ink-2">
                      <span className="mb-1.5 block">人物</span>
                      <select
                        value={personId}
                        onChange={(event) => setPersonId(event.target.value)}
                        className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink"
                      >
                        <option value="">所有人物</option>
                        {(peopleQuery.data?.people ?? []).map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-caption text-ink-2">
                      <input
                        type="checkbox"
                        checked={favoriteOnly}
                        onChange={(event) =>
                          setFavoriteOnly(event.target.checked)
                        }
                      />
                      仅来自收藏相册
                    </label>
                    <label className="flex items-center gap-2 text-caption text-ink-2">
                      <input
                        type="checkbox"
                        checked={pickedOnly}
                        onChange={(event) =>
                          setPickedOnly(event.target.checked)
                        }
                      />
                      仅精选照片
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          </form>

          {statusQuery.isError && usesSemanticSearch ? (
            <p role="alert" className="mt-2 text-caption text-danger">
              本机 AI 状态读取失败，请检查后端服务。
            </p>
          ) : null}
          {status &&
          usesSemanticSearch &&
          (!status.runtimeReady || !status.modelValid) ? (
            <InlineAlert tone="warning" className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {!status.runtimeReady
                    ? "Chinese-CLIP 运行环境尚未就绪。"
                    : "Chinese-CLIP 权重缺失或校验未通过。"}{" "}
                  文字搜索仍可用；权重目录：cacheDir/derived/ai/models/。
                </span>
                <Link to="/tasks/storage" className={buttonStyles({variant:"secondary",size:"sm"})}>
                  查看任务中心
                </Link>
              </div>
            </InlineAlert>
          ) : null}
        </Page>
      </div>

      <Page className="min-h-0 flex-1 pb-2">
        <ContentSearchResults
          submitted={submitted}
          status={status}
          statusError={statusQuery.isError}
          wantsSemantic={submittedSemantic}
          onFindSimilar={findSimilar}
        />
      </Page>
      {status && usesSemanticSearch ? (
        <Page as="p" className="shrink-0 py-2 text-caption text-ink-3">
          {status.device === "cuda"
            ? `${status.gpuName ?? "NVIDIA GPU"} · CUDA ${status.cudaVersion ?? "可用"}`
            : status.runtimeReady
              ? "CPU 推理"
              : "本机运行环境未就绪"}
          {" · "}
          {status.coverage.indexed.toLocaleString()} /{" "}
          {status.coverage.total.toLocaleString()} 张已索引 · <Link to="/tasks/run" className="underline">任务中心</Link>
        </Page>
      ) : null}
    </div>
  );
}
