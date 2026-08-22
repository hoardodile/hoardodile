/**
 * The plugin definition factories now live in `@hoardodile/sdk-types` —
 * the shared contract (see `plugin-definition.ts` there). This module
 * keeps the module path so internal imports stay untouched.
 */
export {
	assertPluginShape,
	createFailingPlugin,
	definePlugin,
	isDetected,
	isMissed,
} from "@hoardodile/sdk-types"
