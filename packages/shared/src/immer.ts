import { enableMapSet, produce } from "immer"

/**
 * Single import point for immer's {@link produce}. Calling
 * {@link enableMapSet} at module load guarantees the plugin runs before
 * any draft operation in production and in isolated unit tests alike -
 * importing `produce` directly from `immer` would risk drafting a `Map`
 * or `Set` before the plugin is registered.
 */
enableMapSet()

export { produce }
