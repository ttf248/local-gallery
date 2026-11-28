import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppMode } from "../api/library";

interface SearchHistory {
  entries: Record<AppMode, string[]>;
  save: (mode: AppMode, query: string) => void;
  remove: (mode: AppMode, query: string) => void;
  clear: (mode: AppMode) => void;
}
export const useSearchHistory = create<SearchHistory>()(
  persist(
    (set) => ({
      entries: { photo: [], comic: [] },
      save: (mode, query) => {
        const value = query.trim();
        if (!value || /^(?:[a-z]:[\\/]|[\\/]|https?:)/i.test(value)) return;
        set((s) => ({
          entries: {
            ...s.entries,
            [mode]: [
              value,
              ...s.entries[mode].filter((x) => x !== value),
            ].slice(0, 8),
          },
        }));
      },
      remove: (mode, value) =>
        set((s) => ({
          entries: {
            ...s.entries,
            [mode]: s.entries[mode].filter((x) => x !== value),
          },
        })),
      clear: (mode) => set((s) => ({ entries: { ...s.entries, [mode]: [] } })),
    }),
    {
      name: "local-gallery-search-history",
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);
