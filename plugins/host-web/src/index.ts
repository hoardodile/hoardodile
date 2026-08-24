/**
 * @hoardodile/host-web — the browser-side plugin host runtime:
 * the shared host-core protocol router (used by apps/web in production
 * and by the offline mock) plus the mock host for component tests and
 * the workbench. The wire protocol itself stays in
 * @hoardodile/sdk-web — this package consumes it, never redefines
 * it. Node file backends live in `@hoardodile/host-web/node`.
 */

export {
	closeDownloadConsent,
	type DownloadConsentEntry,
	decideDownloadConsent,
	enqueueDownloadConsent,
	getDownloadConsentSnapshot,
	rehydrateDownloadConsent,
	requestDownloadConsent,
	resetDownloadConsent,
	subscribeDownloadConsent,
} from "./consent/consent-store.ts"
export { anchorData, requestSchemas } from "./host-core/request-schemas.ts"
export {
	createHostRouter,
	defineHandler,
	type HostBinding,
	type HostHandlerContext,
	type HostHandlerEntry,
	type HostRouterDeps,
} from "./host-core/router.ts"
export {
	createInMemoryFileBackend,
	type MockFileBackend,
	type ReadFileRange,
} from "./mock/file-backends.ts"
export {
	createMockHost,
	type MockHost,
	type MockHostLogger,
	type MockHostOptions,
	type PluginAssetVaultMock,
} from "./mock/host.ts"
export {
	createMockDanmakuStore,
	createMockMessageStore,
	type MockDanmakuStore,
	type MockMessageStore,
} from "./mock/stores.ts"
