/**
 * 搜索的两类对象。
 *
 * 名字搜索找的是相册、文件夹、标签这些**容器**；内容搜索找的是照片里的
 * **画面与文字**。两者检索的东西不同，后端也是两套接口 ——
 * 所以界面上必须说清当前搜的是哪一类，不能共用一个输入框假装是同一个。
 */
export type SearchScope = "name" | "content";

/** 作用域在地址里的参数名。 */
export const SEARCH_SCOPE_PARAM = "scope";

export interface SearchScopeOption {
  value: SearchScope;
  /** 按钮上的短词。 */
  label: string;
  /** 这一类搜的是什么。 */
  hint: string;
}

/** 搜索框里的两档。顺序按「先找得着」排：名字最常用。 */
export const SEARCH_SCOPE_OPTIONS: SearchScopeOption[] = [
  {
    value: "name",
    label: "名称",
    hint: "相册、文件夹与标签的名字",
  },
  {
    value: "content",
    label: "画面",
    hint: "照片里的画面与图片文字",
  },
];

export function searchScopeOption(scope: SearchScope): SearchScopeOption {
  return (
    SEARCH_SCOPE_OPTIONS.find((option) => option.value === scope) ??
    SEARCH_SCOPE_OPTIONS[0]
  );
}

/** 从地址里读作用域；不是内容搜索就是名称搜索。 */
export function searchScopeFromParams(params: URLSearchParams): SearchScope {
  return params.get(SEARCH_SCOPE_PARAM) === "content" ? "content" : "name";
}
