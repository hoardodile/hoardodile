import type { APIRequestContext } from "@playwright/test"
import { idFromTrpcJson } from "./trpcResourceCreate"

/**
 * Server-side e2e API helpers: drive the real HTTP API with Playwright's
 * request fixture so fixtures can be created/torn down without the UI.
 * This server's tRPC is plain JSON in/out — raw bodies, no wrapper.
 */

const SERVER_PORT = process.env.E2E_SERVER_PORT ?? "3001"
const SERVER = `http://127.0.0.1:${SERVER_PORT}`
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? ""

/** Logs in and returns the session cookie header value. */
export async function apiLogin(request: APIRequestContext): Promise<string> {
	const res = await request.post(`${SERVER}/auth/login`, {
		data: { password: PASSWORD },
	})
	if (!res.ok()) {
		throw new Error(`login failed: ${res.status()} ${await res.text()}`)
	}
	const setCookie = res.headers()["set-cookie"]
	if (setCookie === undefined) {
		throw new Error("login response carried no set-cookie header")
	}
	const first = setCookie.split(";")[0]
	if (first === undefined || first.length === 0) {
		throw new Error("login set-cookie header was empty")
	}
	return first
}

/** Stages a single file via the ordered upload endpoint; returns the fileId. */
export async function uploadOrderedFile(
	request: APIRequestContext,
	cookie: string,
	fileBuffer: Buffer,
	filename: string,
	mimeType: string,
): Promise<string> {
	const res = await request.post(`${SERVER}/api/uploads/ordered`, {
		headers: { cookie },
		multipart: {
			file: {
				name: filename,
				mimeType,
				buffer: fileBuffer,
			},
		},
	})
	if (!res.ok()) {
		throw new Error(
			`ordered upload failed: ${res.status()} ${await res.text()}`,
		)
	}
	const body: unknown = await res.json()
	if (body === null || typeof body !== "object" || !("fileId" in body)) {
		throw new Error("ordered upload response missing fileId")
	}
	const { fileId } = body
	if (typeof fileId !== "string") {
		throw new Error("ordered upload fileId was not a string")
	}
	return fileId
}

/** Stages a zip via the archive upload endpoint; returns the fileId. */
export async function uploadArchive(
	request: APIRequestContext,
	cookie: string,
	zipBuffer: Buffer,
	filename: string,
): Promise<string> {
	const res = await request.post(`${SERVER}/api/uploads/archive`, {
		headers: { cookie },
		multipart: {
			archive: {
				name: filename,
				mimeType: "application/zip",
				buffer: zipBuffer,
			},
		},
	})
	if (!res.ok()) {
		throw new Error(
			`archive upload failed: ${res.status()} ${await res.text()}`,
		)
	}
	const body: unknown = await res.json()
	if (body === null || typeof body !== "object" || !("fileId" in body)) {
		throw new Error("archive upload response missing fileId")
	}
	const { fileId } = body
	if (typeof fileId !== "string") {
		throw new Error("archive upload fileId was not a string")
	}
	return fileId
}

export type CreateResourceInput = {
	readonly name: string
	readonly contentPluginId: string
} & (
	| { readonly archiveFileId: string }
	| { readonly files: readonly string[]; readonly names?: readonly string[] }
)

/** Creates a resource from a staged archive; returns the resource id. */
export async function createResource(
	request: APIRequestContext,
	cookie: string,
	input: CreateResourceInput,
): Promise<string> {
	const res = await request.post(`${SERVER}/trpc/resource.create`, {
		headers: { cookie },
		data: input,
	})
	if (!res.ok()) {
		throw new Error(
			`resource.create failed: ${res.status()} ${await res.text()}`,
		)
	}
	const id = idFromTrpcJson(await res.json())
	if (id === undefined) {
		throw new Error("resource.create response missing resource id")
	}
	return id
}

/** Soft- then hard-deletes resources; a no-op on an empty list. */
export async function deleteResources(
	request: APIRequestContext,
	cookie: string,
	ids: readonly string[],
): Promise<void> {
	if (ids.length === 0) return
	for (const proc of ["resource.softDeleteMany", "resource.hardDeleteMany"]) {
		const res = await request.post(`${SERVER}/trpc/${proc}`, {
			headers: { cookie },
			data: { ids: [...ids] },
		})
		if (!res.ok()) {
			throw new Error(`${proc} failed: ${res.status()} ${await res.text()}`)
		}
	}
}

/**
 * Fetches the server's own rolling log files via the app's authenticated
 * `diagnostics.logs` query, concatenated in file order. Works against any
 * server the suite targets — the local webServer or an external instance
 * (Docker image) whose STORAGE_ROOT the test runner cannot see.
 */
export async function fetchServerLogs(
	request: APIRequestContext,
	cookie: string,
): Promise<string> {
	const res = await request.get(`${SERVER}/trpc/diagnostics.logs`, {
		headers: { cookie },
	})
	if (!res.ok()) {
		throw new Error(
			`diagnostics.logs failed: ${res.status()} ${await res.text()}`,
		)
	}
	const files = logFilesFromTrpcJson(await res.json())
	if (files === undefined) {
		throw new Error("diagnostics.logs response missing files")
	}
	return files.join("\n")
}

/**
 * Walks the tRPC HTTP JSON (single, non-batch) for the log file contents.
 * Without a transformer the payload sits at `result.data`; a transformer
 * nests it one level deeper at `result.data.json`. Both shapes are walked.
 */
function logFilesFromTrpcJson(body: unknown): string[] | undefined {
	if (body === null || typeof body !== "object") return undefined
	const obj = body as Record<string, unknown>
	if (!("result" in obj)) return undefined
	const result = obj.result
	if (typeof result !== "object" || result === null) return undefined
	const envelope = result as Record<string, unknown>
	if (!("data" in envelope)) return undefined
	const data = envelope.data
	if (typeof data !== "object" || data === null) return undefined
	const payload =
		"json" in (data as Record<string, unknown>) &&
		typeof (data as Record<string, unknown>).json === "object"
			? ((data as Record<string, unknown>).json as Record<string, unknown>)
			: (data as Record<string, unknown>)
	const files = payload.files
	if (!Array.isArray(files)) return undefined
	const contents: string[] = []
	for (const file of files) {
		if (
			typeof file === "object" &&
			file !== null &&
			"content" in (file as Record<string, unknown>) &&
			typeof (file as Record<string, unknown>).content === "string"
		) {
			contents.push((file as Record<string, unknown>).content as string)
		}
	}
	return contents
}

/** Tiny 1×1 opaque PNG — enough for the thumbnail pipeline to render. */
export const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
)

/** Generic raw-JSON tRPC call (mutations); returns the parsed envelope. */
export async function trpcPost(
	request: APIRequestContext,
	cookie: string,
	procedure: string,
	data: unknown,
): Promise<unknown> {
	const res = await request.post(`${SERVER}/trpc/${procedure}`, {
		headers: { cookie },
		data,
	})
	const body: unknown = await res.json().catch(() => undefined)
	if (!res.ok()) {
		throw new Error(
			`${procedure} failed: ${res.status()} ${JSON.stringify(body)}`,
		)
	}
	// tRPC reports procedure failures as HTTP 200 with an error envelope.
	if (body !== null && typeof body === "object" && "error" in body) {
		throw new Error(
			`${procedure} tRPC error: ${JSON.stringify(
				(body as Record<string, unknown>).error,
			)}`,
		)
	}
	return body
}

/**
 * Uploads the tag's image slot directly against the shared image-slot
 * HTTP surface (the crop dialog is covered by unit tests; the e2e
 * focuses on what the chip surfaces render).
 */
export async function putTagImage(
	request: APIRequestContext,
	cookie: string,
	tagId: string,
	buffer: Buffer,
): Promise<void> {
	const res = await request.put(`${SERVER}/api/tags/${tagId}/images/image`, {
		headers: {
			cookie,
			"content-type": "application/octet-stream",
			"x-filename": "art.png",
		},
		data: buffer,
	})
	if (!res.ok()) {
		throw new Error(
			`tag image upload failed: ${res.status()} ${await res.text()}`,
		)
	}
}
