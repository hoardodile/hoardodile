/**
 * Node-side file backends for the offline mock host: real directories,
 * read through the host's own containers so mock reads behave exactly
 * like production reads. Component tests point the mock at a storage
 * root or a fixture directory with no server involved.
 */
import {
	createDirectoryContainer,
	createPluginResourceAPI,
} from "@hoardodile/host"
import type { MockFileBackend } from "../mock/file-backends.ts"

/**
 * A mock file backend over a raw directory — a resource folder under a
 * real storage root (bare files, the production shape) or a plain
 * fixture directory. Read-only by construction — immutable versioned
 * partitions make this bypass safe.
 */
export function createDirectoryFileBackend(dir: string): MockFileBackend {
	const api = createPluginResourceAPI({ view: createDirectoryContainer(dir) })
	return {
		async listFiles() {
			return api.listFileNames()
		},
		async readFile(_resId, path, range) {
			const bytes = await api.readFile(path, range)
			return transferOwned(bytes)
		},
		async statFile(_resId, path) {
			return api.statFile(path)
		},
	}
}

function transferOwned(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer
}
