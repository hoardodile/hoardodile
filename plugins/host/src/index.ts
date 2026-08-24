/**
 * @hoardodile/host — the plugin runtime host: plugin loading,
 * capability-sandboxed child processes (Node permission model + module
 * policy), hook invocation strategy, ResourceAPI builders, probe caching,
 * and capability gating. The server, the CLI, and future shells (desktop,
 * MCP) all consume this same implementation so that "what you test is
 * what runs in production".
 *
 * This root entry is the app-side runtime surface — the plugin
 * authoring API lives in `@hoardodile/sdk-server` (which re-exports the
 * authoring subset of the contract from `@hoardodile/sdk-types`).
 * `runPluginHook` is the one dev-only helper plugin authors use from
 * tests (as a devDependency — never shipped in a plugin bundle).
 */

export type {
	PluginActivation,
	PluginActivationDeps,
} from "./activation.ts"
export { createPluginActivation } from "./activation.ts"
export {
	type CreatePluginResourceAPIDeps,
	createImportResourceAPI,
	createPluginResourceAPI,
	DEFAULT_PLUGIN_EXTRACT_MAX_BYTES,
	DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES,
} from "./api.ts"
export type {
	FoundPlugin,
	MissingPlugin,
	PluginDefinition,
	PluginRegistry,
	PluginRegistryEntry,
} from "./api-types.ts"
export type { NestedCdCache } from "./archive/index.ts"
export {
	createNestedCdCache,
	listZipEntries,
	materializeFile,
} from "./archive/index.ts"
export type {
	CapabilityGuard,
	PluginCapability,
} from "./capability-guard.ts"
export { createCapabilityGuard } from "./capability-guard.ts"
export type { ResourceContainer } from "./container.ts"
export {
	assertPluginShape,
	createFailingPlugin,
	definePlugin,
	isDetected,
	isMissed,
} from "./define-plugin.ts"
export { type PluginHookName, runPluginHook } from "./dev-runner.ts"
export {
	createDirectoryResourceAPI,
	resolveSafeImportPath,
} from "./directory-api.ts"
export { createDirectoryContainer } from "./directory-container.ts"
export type {
	PluginDiscovery,
	PluginDiscoveryDeps,
} from "./discovery.ts"
export { createPluginDiscovery, parseManifest } from "./discovery.ts"
export type { DomainErrorCode } from "./errors.ts"
export {
	conflict,
	DomainError,
	invalid,
	notFound,
} from "./errors.ts"
export type { ResourceAPIFixtureConfig } from "./fixtures.ts"
export { createResourceAPIFixture, stubLogger } from "./fixtures.ts"
export {
	computeDHash,
	computePHash,
	grayStddev,
	MIN_PERCEPTUAL_STDDEV,
	PERCEPTUAL_HASH_KINDS,
	PHASH_GRID,
} from "./hash.ts"
export type {
	PluginHooks,
	PluginHooksDeps,
	PluginMetaHookResults,
} from "./hooks.ts"
export { createPluginHooks } from "./hooks.ts"
export type {
	PluginLoader,
	PluginLoaderDeps,
} from "./loader.ts"
export {
	buildRegistry,
	createPluginLoader,
	seedPlugins,
} from "./loader.ts"
export { createNestedAwareContainer } from "./nested-view.ts"
export {
	createProbeCache,
	PLUGIN_PROBE_CACHE_MAX_ENTRIES,
	type PluginProbeCache,
} from "./probe-cache.ts"
export type {
	PluginAssetHandler,
	PluginSandbox,
	PluginSandboxConfig,
} from "./sandbox/host.ts"
export {
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	PLUGIN_HOOK_HARD_TIMEOUT_MS,
	PLUGIN_MAX_API_CALLS_PER_HOOK,
	PLUGIN_MAX_LOGS_PER_HOOK,
	PLUGIN_MAX_RESULT_BYTES,
	PLUGIN_WATCHDOG_TIMEOUT_MS,
	PLUGIN_WORKER_MAX_OLD_SPACE_MB,
	PLUGIN_WORKER_MAX_RESPAWNS,
	PLUGIN_WORKER_RESPAWN_WINDOW_MS,
} from "./sandbox/host.ts"
export { HOOK_NAMES, type HookName } from "./sandbox/protocol.ts"
export type {
	PluginSettingsRow,
	PluginSettingsStore,
} from "./settings-store.ts"
export type {
	AudioCoverArt,
	AudioInfo,
	AudioTags,
	Detection,
	ImageInfo,
	Logger,
	ReadFileRange,
	ResourceAPI,
	VideoInfo,
} from "./types.ts"
