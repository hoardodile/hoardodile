/**
 * Action vocabulary — the canonical binding of recurring chrome actions to
 * glyphs. Import action icons from here, never by glyph name: two places
 * that both mean "add" both render `Add`, so auditing an action is a
 * single grep. Check stays under its own name — there is exactly one
 * check, it cannot be confused.
 */

export { Check, Cross as Remove, Plus as Add } from "./marks.tsx"
export { MenuDots as More } from "./registry"
