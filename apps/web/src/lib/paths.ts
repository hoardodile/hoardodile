/**
 * Central URL path definitions for all server endpoints.
 *
 * Every non-tRPC URL used in the app should be generated through this file.
 * This eliminates hard-coded path strings scattered across components and
 * makes route changes a single-point update.
 *
 * All functions are pure and have no runtime dependencies, so they can be
 * safely imported by the service worker as well.
 */

export const apiPaths = {
	auth: {
		status: () => "/auth/status",
		setup: () => "/auth/setup",
		login: () => "/auth/login",
		password: () => "/auth/password",
		logout: () => "/auth/logout",
	},

	characters: {
		image: (id: string, variant: string) =>
			`/api/characters/${id}/images/${variant}`,
		thumb: (id: string, variant: string) =>
			`/api/characters/${id}/thumb/${variant}`,
	},

	tags: {
		image: (id: string) => `/api/tags/${id}/images/image`,
		thumb: (id: string) => `/api/tags/${id}/thumb/image`,
	},

	resources: {
		cover: (id: string) => `/api/resources/${id}/cover`,
		files: (id: string, filename: string) =>
			`/api/resources/${id}/files/${encodeURIComponent(filename)}`,
		sourceZip: (id: string) => `/api/resources/${id}/source.zip`,
		bulkSourceZip: () => "/api/resources/bulk-source.zip",
	},

	uploads: {
		ordered: () => "/api/uploads/ordered",
		orderedFile: (fileId: string) =>
			`/api/uploads/ordered/${encodeURIComponent(fileId)}`,
		stagedPreview: (fileId: string) =>
			`/api/uploads/staged/${encodeURIComponent(fileId)}/preview`,
		archive: () => "/api/uploads/archive",
	},

	imageSearch: {
		upload: () => "/api/image-search",
		queryImage: (sessionId: string) =>
			`/api/image-search/${encodeURIComponent(sessionId)}/image`,
	},

	cache: {
		root: () => "/api/cache",
		trash: () => "/api/cache/trash",
		trashDownload: (name: string) =>
			`/api/cache/trash/${encodeURIComponent(name)}/download`,
	},

	precache: {
		start: () => "/api/precache",
		abort: () => "/api/precache/abort",
		stream: () => "/api/precache/stream",
	},

	plugins: {
		indexHtml: (id: string, assetVersion?: string) =>
			`/api/plugins/${encodeURIComponent(id)}/index.html${assetVersion !== undefined ? `?v=${encodeURIComponent(assetVersion)}` : ""}`,
		asset: (id: string, rel: string) => `/api/plugins/${id}/${rel}`,
	},

	pluginUpload: () => "/api/plugin-upload",

	pluginMarketplace: {
		install: () => "/api/plugin-marketplace/install",
	},

	events: () => "/api/events",
} as const
