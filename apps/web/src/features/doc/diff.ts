/**
 * Diff machinery is deliberately kept out of the main bundle: blocknote
 * core, prosemirror-changeset/state/transform and the suggestion-mark
 * transform only load when a document diff actually opens (see
 * `loadDiffModule`). This file carries only the shared block shape type.
 */
export type { DiffableBlock } from "./diffCompute.ts"

/**
 * Load the heavy diff module once, cached for the page's lifetime. Called
 * from the diff-activation path (a user gesture), so the chunk never
 * blocks initial load.
 */
let diffModulePromise: Promise<typeof import("./diffCompute.ts")> | undefined

export function loadDiffModule(): Promise<typeof import("./diffCompute.ts")> {
	diffModulePromise ??= import("./diffCompute.ts")
	return diffModulePromise
}
