/**
 * The consent-dialog queue lives in `@hoardodile/host-web` (the shared
 * browser host-core, React-free). This module re-exports it for the app:
 * the SSE handlers feed it (`pluginDownloadRequested` /
 * `pluginDownloadResolved`), the dialog consumes it, and decisions go to
 * the server (`pluginAsset.decide`) — which broadcasts the resolution
 * that closes the entry everywhere.
 */
export * from "@hoardodile/host-web"
