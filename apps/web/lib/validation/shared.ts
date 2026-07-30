import { z } from "zod";

/**
 * Deliberately `z.number()`, NOT `z.coerce.number()`. `z.coerce.*` schemas
 * are defined internally as `z.any().transform(...)`, so `z.input<>` of a
 * coerce schema is always `unknown` — that breaks `useForm<T>({ resolver:
 * zodResolver(schema) })`'s type inference (`Resolver<T>`'s input generic
 * ends up `unknown` for these fields, which TypeScript then refuses to
 * assign to `useForm<T>`'s expected `Resolver<T>`). The numeric `<input>`
 * fields in this app's forms all use React Hook Form's own `valueAsNumber:
 * true` register option instead, which converts the DOM string to a real
 * `number` *before* the resolver ever sees it — so by the time Zod
 * validates, the value already is a `number`, and plain `z.number()` (whose
 * `z.input`/`z.output` are both cleanly `number`, no `unknown`) is both
 * sufficient and simpler. Same reasoning applies to every other
 * `money`/optional-field helper in this file: chains built from
 * `.transform()`/`.refine()` on a concrete base schema (not `z.preprocess`/
 * `z.coerce`, both of which start from an `unknown`-typed base) keep
 * `z.input` equal to that concrete base type all the way through the chain.
 */
export function money(label: string) {
  return z.number({ error: `${label} must be a number` }).min(0, `${label} cannot be negative`);
}

/** An optional numeric field (e.g. capital gains' `indexedGainAmount`) — `undefined` when omitted, otherwise validated like `money`. */
export function optionalMoney(label: string) {
  return z.number({ error: `${label} must be a number` }).optional();
}

/**
 * An optional trimmed string: empty (after trim, and after `mapper` — e.g.
 * uppercasing or stripping spaces) becomes `undefined`; a non-empty value
 * must satisfy `pattern`. Built entirely from `.transform()`/`.refine()` on
 * a concrete `z.string()` base, with a trailing `.optional()` — see the
 * `money` comment above for why `.transform()` (unlike `.preprocess()`/
 * `.coerce`) keeps `z.input` concrete rather than `unknown`. The trailing
 * `.optional()` matters too: without it, `z.input` (required `string`,
 * since the transform chain's input traces back to the base `z.string()`)
 * and `z.output` (`string | undefined`, from the "" -> undefined transform)
 * would DIVERGE — `zodResolver`'s `Resolver<Input, Context, Output>` needs
 * both to line up with `useForm<T>`'s single `T`, which only works when
 * `Input` and `Output` are the same shape. Wrapping in `.optional()` makes
 * `z.input` ALSO `string | undefined` (still accepts a plain `""` from an
 * HTML input — `string` is assignable to `string | undefined`), matching
 * `z.output` and resolving the mismatch.
 */
export function optionalPattern(pattern: RegExp, message: string, mapper: (value: string) => string = (v) => v) {
  return z
    .string()
    .trim()
    .transform(mapper)
    .refine((value) => value === "" || pattern.test(value), message)
    .transform((value) => (value === "" ? undefined : value))
    .optional();
}

/** An optional free-text field with just a max length, no pattern. See `optionalPattern`'s comment for why the trailing `.optional()` is load-bearing. */
export function optionalText(maxLen: number, label: string) {
  return z
    .string()
    .trim()
    .refine((value) => value.length <= maxLen, `${label} is too long`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();
}
