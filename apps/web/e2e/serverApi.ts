import type { APIRequestContext } from "@playwright/test"
import { resourceIdFromTrpcCreateJson } from "./trpcResourceCreate"

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
	const id = resourceIdFromTrpcCreateJson(await res.json())
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
