import { cx } from "./cx";
type SlotClasses = Record<string, string>;
type Choices = Record<string, Record<string, string | SlotClasses>>;
type Selection<V extends Choices> = { [K in keyof V]: keyof V[K] };
export interface VariantConfig<
  V extends Choices,
  S extends SlotClasses = SlotClasses,
> {
  base: string;
  variants: V;
  defaults: Selection<V>;
  slots?: S;
  compoundVariants?: ReadonlyArray<{
    when: Partial<Selection<V>>;
    className: string | SlotClasses;
  }>;
}
export type VariantProps<V extends Choices> = Partial<Selection<V>>;
export function variants<V extends Choices, S extends SlotClasses>(
  config: VariantConfig<V, S>,
) {
  type Props = VariantProps<V> & { className?: string };
  function resolve(slot: string, props: Props) {
    const selected = (key: keyof V) => props[key] ?? config.defaults[key];
    const at = (part: string | SlotClasses | undefined) =>
      typeof part === "string"
        ? slot === "base"
          ? part
          : undefined
        : part?.[slot];
    return cx(
      slot === "base" ? config.base : config.slots?.[slot],
      ...Object.keys(config.variants).map((key) =>
        at(config.variants[key][String(selected(key))]),
      ),
      ...(config.compoundVariants ?? [])
        .filter((rule) =>
          Object.entries(rule.when).every(
            ([k, value]) => selected(k) === value,
          ),
        )
        .map((rule) => at(rule.className)),
      slot === "base" && props.className,
    );
  }
  function recipe(props: Props = {}) {
    return resolve("base", props);
  }
  recipe.slots = (props: Props = {}) =>
    Object.fromEntries(
      ["base", ...Object.keys(config.slots ?? {})].map((slot) => [
        slot,
        resolve(slot, props),
      ]),
    ) as Record<"base" | keyof S, string>;
  return recipe;
}
