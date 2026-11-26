import { cx } from "./cx";
type Choices = Record<string, Record<string, string>>;
export type VariantConfig<V extends Choices> = {
  base: string;
  variants: V;
  defaults: { [K in keyof V]: keyof V[K] };
};
export type VariantProps<V extends Choices> = Partial<
  VariantConfig<V>["defaults"]
>;
export function variants<V extends Choices>(config: VariantConfig<V>) {
  return (props: VariantProps<V> & { className?: string } = {}) =>
    cx(
      config.base,
      ...Object.keys(config.variants).map(
        (key) =>
          config.variants[key][String(props[key] ?? config.defaults[key])],
      ),
      props.className,
    );
}
