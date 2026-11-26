interface SimilarityGroup {
  id: string;
  kind: "exact";
  folder: string;
  resourceIds: string[];
  members: {
    resourceId: string;
    folder: string;
    albumId: string;
    albumName: string;
    width: number;
    height: number;
    quality: {
      sharpness: number;
      sharpnessScore: number;
      megapixels: number;
      resolutionScore: number;
      exposure: number;
      clippedHigh: number;
      clippedLow: number;
      exposureScore: number;
      score: number;
    };
    distance: number;
    similarity: number;
    score: number;
  }[];
  recommended: string;
  representative: string;
  representativeIsManual: boolean;
  distance: number;
  similarity: number;
  timeSpanMs: number;
  timeSource: string;
  crossFolder: boolean;
  status: "pending";
  redundant: number;
}



export function makeGroup(index: number, resourceIds: string[]): SimilarityGroup {
  const quality = {
    sharpness: 820,
    sharpnessScore: 0.86,
    megapixels: 12,
    resolutionScore: 0.82,
    exposure: 0.45,
    clippedHigh: 0.02,
    clippedLow: 0.01,
    exposureScore: 0.9,
    score: 0.86,
  };
  const members = resourceIds.map((resourceId) => ({
    resourceId,
    folder: "分页验证",
    albumId: "a_1",
    albumName: "分页验证",
    width: 4000,
    height: 3000,
    quality,
    distance: 0,
    similarity: 1,
    score: 0.86,
  }));
  return {
    id: `pagination-${index + 1}`,
    kind: "exact",
    folder: "分页验证",
    resourceIds,
    members,
    recommended: resourceIds[0],
    representative: resourceIds[0],
    representativeIsManual: false,
    distance: 0,
    similarity: 1,
    timeSpanMs: 0,
    timeSource: "capture",
    crossFolder: false,
    status: "pending",
    redundant: 1,
  };
}

