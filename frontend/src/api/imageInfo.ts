import { api } from "./client";

export interface ImageInfo {
  path: string;
  name: string;
  dir: string;
  size: number;
  mtime: string;
  width: number;
  height: number;
  format: string;
  checksum: string;
}

export const imageInfoApi = {
  get(fileId: string) {
    return api<ImageInfo>(`/api/images/${encodeURIComponent(fileId)}/info`);
  },
};
