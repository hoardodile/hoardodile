/**
 * The ResourceAPI fixtures now live in `@hoardodile/sdk-types` — the
 * shared contract (see `plugin-definition.ts` there). This module keeps
 * the module path so internal imports stay untouched.
 */

export type { ResourceAPIFixtureConfig } from "@hoardodile/sdk-types"
export { createResourceAPIFixture, stubLogger } from "@hoardodile/sdk-types"
