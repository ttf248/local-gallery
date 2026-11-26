import { cx } from "../../ui/cx";

export function albumGridClass(comic: boolean, density = "default") {
  return cx(
    "library-grid grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--album-min)),1fr))] gap-x-6 gap-y-9 max-sm:grid-cols-2 2xl:gap-x-8 2xl:gap-y-11",
    comic
      ? "library-grid--comic [--album-min:160px] 2xl:[--album-min:200px]"
      : "[--album-min:240px] xl:[--album-min:260px] 2xl:[--album-min:300px] 3xl:[--album-min:340px]",
    !comic && density !== "default" && "library-grid--" + density,
  );
}
