import { api } from "./client";

export interface PeopleAnnotationIdentity {
  id: string;
  label?: string;
}

export interface PeopleAnnotationFace {
  identity: string;
  box: [number, number, number, number];
  smallFace?: boolean;
  source?: "detected" | "manual";
}

export interface PeopleAnnotationPhoto {
  resourceId: string;
  tags: string[];
  faces: PeopleAnnotationFace[];
  reviewed: boolean;
  updatedAt: string;
}

export interface PeopleAnnotationSample {
  resourceId: string;
  personId?: string;
  personName?: string;
  reason: string;
  faceCount: number;
  reviewed: boolean;
  identities?: string[];
}

export interface PeopleAnnotationProgress {
  sampleCount: number;
  reviewedCount: number;
  annotatedPhotoCount: number;
  faceCount: number;
  identityCount: number;
}

export interface PeopleAnnotationPhotoDetail {
  resourceId: string;
  width: number;
  height: number;
  detected: {
    key: string;
    resourceId: string;
    faceIndex: number;
    personId: string;
    box: [number, number, number, number];
    score: number;
  }[];
  annotation?: PeopleAnnotationPhoto;
}

export interface PeopleAnnotationSamplesResponse {
  ok: boolean;
  items: PeopleAnnotationSample[];
  progress: PeopleAnnotationProgress;
  scenarioTags: string[];
}

export interface PeopleAnnotationPhotoResponse {
  ok: boolean;
  photo: PeopleAnnotationPhotoDetail;
}

const ANNOTATION_BASE = "/api/admin/people/annotations";

export const peopleAnnotationsApi = {
  async samples(refresh = false): Promise<PeopleAnnotationSamplesResponse> {
    return api<PeopleAnnotationSamplesResponse>(
      `${ANNOTATION_BASE}/samples`,
      { params: { refresh: refresh ? "true" : undefined } },
    );
  },
  async photo(resourceId: string): Promise<PeopleAnnotationPhotoResponse> {
    return api<PeopleAnnotationPhotoResponse>(
      `${ANNOTATION_BASE}/photo/${encodeURIComponent(resourceId)}`,
    );
  },
  async save(body: {
    resourceId: string;
    tags: string[];
    faces: PeopleAnnotationFace[];
    reviewed: boolean;
  }): Promise<{ ok: boolean; progress: PeopleAnnotationProgress }> {
    return api<{ ok: boolean; progress: PeopleAnnotationProgress }>(
      `${ANNOTATION_BASE}/photo`,
      { method: "POST", body },
    );
  },
  async identities(): Promise<{
    ok: boolean;
    items: PeopleAnnotationIdentity[];
  }> {
    return api<{ ok: boolean; items: PeopleAnnotationIdentity[] }>(
      `${ANNOTATION_BASE}/identities`,
    );
  },
  async createIdentity(label: string): Promise<{
    ok: boolean;
    identity: PeopleAnnotationIdentity;
  }> {
    return api<{ ok: boolean; identity: PeopleAnnotationIdentity }>(
      `${ANNOTATION_BASE}/identities`,
      { method: "POST", body: { label } },
    );
  },
  async progress(): Promise<{
    ok: boolean;
    progress: PeopleAnnotationProgress;
  }> {
    return api<{ ok: boolean; progress: PeopleAnnotationProgress }>(
      `${ANNOTATION_BASE}/progress`,
    );
  },
  datasetUrl(): string {
    return `${ANNOTATION_BASE}/dataset`;
  },
};
