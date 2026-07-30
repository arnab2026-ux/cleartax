/**
 * The single assessment year this wizard targets. `packages/tax-engine`
 * only implements AY 2026-27 (see `packages/tax-engine/src/ay2026-27/`) —
 * hardcoding this in one place means every page/action that needs "the
 * current AY" imports it from here rather than duplicating the string
 * literal, so a future multi-year version only has to change this file (plus
 * add a new `ay20XX-XX` directory to the engine).
 */
export const CURRENT_ASSESSMENT_YEAR = "2026-27";
