import { variants } from "./variants";
export const buttonStyles = variants({
  base: "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-label transition duration-fast motion-safe:enabled:active:scale-[.98] disabled:cursor-default disabled:opacity-40",
  variants: {
    variant: {
      primary: "bg-primary text-on-primary",
      secondary: "border border-line-strong bg-raised hover:bg-hover",
      ghost: "hover:bg-hover",
      accent: "bg-accent text-on-accent",
      danger: "text-danger hover:bg-danger/10",
    },
    size: {
      sm: "h-8 px-2.5 touch:min-h-10",
      md: "h-9 px-3.5 touch:min-h-10",
      lg: "h-11 px-[18px]",
    },
  },
  defaults: { variant: "primary", size: "md" },
});
