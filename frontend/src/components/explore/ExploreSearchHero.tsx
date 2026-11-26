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
 * 发现页顶部的搜索入口。
 *
 * 发现页先给找法，再给预览：用户带着一个问题进来，这一块是那把钥匙。
 * 两类检索对象摆在一个输入框旁边（名字 / 画面与文字），因为它们真的
 * 是两件事 —— 合成一个「万能搜索」，搜不到时用户只会以为库里没有。
 *
 * 入口本身是这一页唯一的主控件：52px 高的一整行，占据首屏最重的位置。
 * 它不套白底面板，也不挂一个「我要找什么」的标题 —— 画布上那一条输入
 * 框本身就是入口，再加一层说明只是把同一句话说两遍。搜的是哪一类，
 * 由输入框里的提示词说清楚（随作用域换），不由另一行灰字重复。
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

  const placeholder =
    scope === "name"
      ? "相册、文件夹、人物或标签"
      : "照片里的画面与文字";

  return (
    <section aria-labelledby="explore-search-title" className="pb-2">
      <h2 id="explore-search-title" className="sr-only">
        搜索
      </h2>
      {/* 入口占住首屏最重的位置，但宽度有上限：一个词用不着一千多像素
          的输入框，按钮与输入框分得越开，越难当成一个整体。 */}
      <form className="mx-auto max-w-[680px]" onSubmit={submit}>
        <div className="explore-search input-focus-ring">
          <SearchIcon size={16} className="shrink-0 text-fg-subtle" />
          <label className="sr-only" htmlFor="explore-search-input">
            搜索
          </label>
          <input
            id="explore-search-input"
            aria-label="搜索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            maxLength={200}
            placeholder={placeholder}
            className="explore-search__input"
          />
          <button
            type="submit"
            className="btn btn-primary h-11 shrink-0 px-5"
            disabled={!keyword.trim()}
          >
            搜索
          </button>
        </div>
        <div className="mt-3">
          <Segmented
            label="搜索范围"
            value={scope}
            onChange={setScope}
            options={[
              {
                value: "name",
                label: "名称",
                title: "搜相册、文件夹、人物与标签的名字",
              },
              {
                value: "content",
                label: "画面与文字",
                title: "搜照片里的画面与图片文字",
              },
            ]}
          />
        </div>
      </form>
    </section>
  );
}
