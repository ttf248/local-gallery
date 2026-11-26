import { cx } from "../../ui/cx";

export function albumGridClass(comic: boolean, density = "default") {
  return cx(
    "library-grid grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--album-min)),1fr))] gap-x-6 gap-y-8 max-sm:grid-cols-2",
    comic
      ? "library-grid--comic [--album-min:160px] 2xl:[--album-min:200px]"
      : "[--album-min:220px] min-[1600px]:[--album-min:260px] min-[2240px]:[--album-min:300px]",
    !comic && density !== "default" && "library-grid--" + density,
  );
}
