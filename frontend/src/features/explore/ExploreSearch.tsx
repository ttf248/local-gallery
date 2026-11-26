import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Segmented from "../../ui/Segmented";
import { SearchField } from "../../ui/Field";
import { SEARCH_SCOPE_PARAM, type SearchScope } from "../../utils/searchScope";
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
export default function ExploreSearch() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<SearchScope>("name");
  const [keyword, setKeyword] = useState("");

  const submit = (value: string) => {
    const query = value.trim();
    if (!query) return;
    const params = new URLSearchParams();
    params.set(LIST_PARAM.query, query);
    if (scope === "content") params.set(SEARCH_SCOPE_PARAM, "content");
    navigate(`${searchRoute("photo")}?${params.toString()}`);
  };

  const placeholder =
    scope === "name" ? "相册、文件夹、人物或标签" : "照片里的画面与文字";

  return (
    <SearchField
      size="lg"
      className="max-w-[760px]"
      aria-label="搜索"
      maxLength={200}
      placeholder={placeholder}
      value={keyword}
      onChange={setKeyword}
      onSubmit={submit}
      scope={
        <Segmented
          label="搜索范围"
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "name", label: "名称" },
            { value: "content", label: "画面与文字" },
          ]}
        />
      }
    />
  );
}
