import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import Segmented from "../common/Segmented";
import { SearchIcon } from "../common/Icon";
import {
  SEARCH_SCOPE_PARAM,
  type SearchScope,
} from "../../utils/searchScope";
import { searchRoute } from "../../utils/path";
import { LIST_PARAM } from "../../utils/listFilterParams";

/**
 * 发现页顶部的「我要找什么」。
 *
 * 发现页先给找法，再给预览：用户带着一个问题进来，这一块是那把钥匙。
 * 两类检索对象摆在一个输入框旁边（名字 / 画面与文字），因为它们真的
 * 是两件事 —— 合成一个「万能搜索」，搜不到时用户只会以为库里没有。
 */
export default function ExploreSearchHero() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<SearchScope>("name");
  const [keyword, setKeyword] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keyword.trim();
    if (!query) return;
    const params = new URLSearchParams();
    params.set(LIST_PARAM.query, query);
    if (scope === "content") params.set(SEARCH_SCOPE_PARAM, "content");
    navigate(`${searchRoute("photo")}?${params.toString()}`);
  };

  return (
    /* 这块不再是一张卡片：整页只有这一个搜索框，卡片把它框成了一个
       「小部件」，反而把它压成了次要的东西。标题、输入框与说明直接
       摆在画布上，靠字号与留白分层。 */
    <section aria-labelledby="explore-search-title" className="pb-2">
      <h2 id="explore-search-title" className="section-title">
        我要找什么
      </h2>
      <form className="mt-4" onSubmit={submit}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-12 min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg border border-border bg-bg focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/20">
            <SearchIcon
              size={15}
              className="ml-3 shrink-0 text-fg-subtle"
            />
            <label className="sr-only" htmlFor="explore-search-input">
              搜索
            </label>
            <input
              id="explore-search-input"
              aria-label="搜索"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              maxLength={200}
              placeholder="名字，或照片里的画面与文字"
              className="h-full min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 text-body text-fg outline-none placeholder:text-fg-subtle"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary h-12"
            disabled={!keyword.trim()}
          >
            搜索
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Segmented
            label="搜索范围"
            value={scope}
            onChange={setScope}
            options={[
              { value: "name", label: "名称" },
              { value: "content", label: "画面与文字" },
            ]}
          />
          <p className="text-meta text-fg-muted">
            {scope === "name"
              ? "搜相册、文件夹与标签的名字。"
              : "搜照片里的画面与图片文字，例如「雪」或「手写便签」。"}
          </p>
        </div>
      </form>
    </section>
  );
}
