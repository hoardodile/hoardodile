import { readFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import type { SidecarHandle } from "./sidecar.ts"

export type DevelopmentBackend = {
	url: string
	port: number
	token: string
	storageRoot: string
	addressFile?: string
}

export function readDevelopmentBackend(
	packaged: boolean,
	env: NodeJS.ProcessEnv = process.env,
): DevelopmentBackend | undefined {
	if (packaged || !env.HOARDODILE_DEV_BACKEND_URL) return undefined
	const url = new URL(env.HOARDODILE_DEV_BACKEND_URL)
	const token = env.HOARDODILE_DEV_BACKEND_TOKEN
	const storageRoot = env.HOARDODILE_DEV_STORAGE_ROOT
	const addressFile = env.HOARDODILE_DEV_BACKEND_FILE
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		!url.port ||
		!token ||
		!/^[a-f0-9]{64}$/.test(token) ||
		!storageRoot ||
		!isAbsolute(storageRoot) ||
		(addressFile !== undefined && !isAbsolute(addressFile))
	) {
		throw new Error("Invalid shared development backend configuration")
	}
	return {
		url: url.href,
		port: Number(url.port),
		token,
		storageRoot,
		addressFile,
	}
}

/** The desktop is a client of pnpm dev and never stops or claims its database. */
export function connectDevelopmentBackend(
	backend: DevelopmentBackend,
): SidecarHandle {
	let port = backend.port
	function currentPort() {
		if (backend.addressFile) {
			try {
				const value: unknown = JSON.parse(
					readFileSync(backend.addressFile, "utf8"),
				)
				if (
					value &&
					typeof value === "object" &&
					"version" in value &&
					value.version === 1 &&
					"storageRoot" in value &&
					value.storageRoot === backend.storageRoot &&
					"port" in value &&
					typeof value.port === "number" &&
					Number.isInteger(value.port) &&
					value.port > 0 &&
					value.port <= 65535
				)
					port = value.port
			} catch {
				/* Keep the last valid address while the launcher restarts. */
			}
		}
		return port
	}
	return {
		get url() {
			return `http://127.0.0.1:${currentPort()}/`
		},
		get port() {
			return currentPort()
		},
		shutdownToken: backend.token,
		async stop() {},
		onCrash: () => () => {},
	}
}
