/**
 * 内容搜索「没搜到」的原因。
 *
 * 三种情况必须分开说：
 *   - **失败**：请求本身没成功，重试有用；
 *   - **没索引**：画面索引或文字识别还没跑，库里可能有，搜不出来；
 *   - **真的没有**：都查过了，确实没有匹配。
 *
 * 把它们混成一句「没有找到」，用户会以为库里没有那张照片。
 */
export interface ContentSearchState {
  total: number;
  /** 本机分析状态读不出来。 */
  statusError: boolean;
  /** 画面模型是否就绪；null 是还没读到状态。 */
  modelReady: boolean | null;
  /** 照片还没算过画面向量。 */
  notIndexed: boolean;
  /**
   * 用户是不是想按画面找。
   *
   * 与「这次实际查了什么」不是一回事：画面模型没就绪时，系统会退成
   * 只查图片里的文字。用户要的仍然是画面 —— 零结果时要说清是环境
   * 没准备好，而不是说「库里没有」。
   */
  wantsSemantic: boolean;
  /** 这次确实查了图片里的文字。 */
  searchedOCR: boolean;
  /** 画面与文字都查了。 */
  searchedBoth: boolean;
}

export interface ContentEmptyState {
  title: string;
  description: string;
  /** 下一步：去任务中心跑分析，还是就地重试。 */
  action?: "tasks" | "retry";
}

/**
 * 按状态说清「为什么没搜到」。
 *
 * 标题与说明分开写清楚：哪一种是能靠下一步解决的（跑一次分析），
 * 哪一种是换个词就能解决的（库里确实没有）。
 */
export function contentEmptyState(input: ContentSearchState): ContentEmptyState {
  const {
    total,
    statusError,
    modelReady,
    notIndexed,
    wantsSemantic,
    searchedOCR,
    searchedBoth,
  } = input;
  if (total > 0) {
    return {
      title: "没有匹配的照片",
      description: "试试换个说法，或放宽相册、年份与地点筛选。",
    };
  }
  if (statusError) {
    return {
      title: "搜索失败",
      description: "本机分析状态读不出来，稍后重试。",
      action: "retry",
    };
  }
  if (wantsSemantic && modelReady === false) {
    return {
      title: "画面搜索还没准备好",
      description:
        "本机画面模型未就绪，这次没能按画面内容检索。" +
        (searchedOCR ? "图片里的文字已经查过了，确实没有匹配。" : "") +
        "到任务中心看一眼本机的分析环境。",
      action: "tasks",
    };
  }
  if (wantsSemantic && notIndexed) {
    return {
      title: "还没有建立画面索引",
      description:
        "照片还没有算过画面向量，现在按画面内容搜不出来。" +
        (searchedOCR ? "图片里的文字已经查过了，确实没有匹配。" : "") +
        "到任务中心运行一次向量任务后就能搜了。",
      action: "tasks",
    };
  }
  if (wantsSemantic && searchedBoth) {
    return {
      title: "没有匹配的照片",
      description: "画面内容与图片文字都查过了，没有匹配。换个说法再找一次。",
    };
  }
  if (searchedOCR) {
    return {
      title: "没有匹配的图片文字",
      description: "照片里的文字没有这个说法。换个词，或用画面描述再找一次。",
    };
  }
  return {
    title: "没有匹配的照片",
    description: "当前相册、年份与地点条件下没有照片。",
  };
}
