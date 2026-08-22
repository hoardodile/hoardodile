import { gunzipSync, gzipSync } from "node:zlib"
import type { SQL } from "drizzle-orm"
import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	sql,
} from "drizzle-orm"
import { likeContainsLower } from "src/domain/res/like.ts"
import {
	buildFindById,
	buildPatch,
	buildRemove,
} from "src/infra/db/builders.ts"
import type { DbClient } from "src/infra/db/connection.ts"

const EMPTY_BLOCKNOTE_DOC: Record<string, unknown> = {
	version: 2,
	blocks: [],
}

export function encodeContent(value: unknown): Buffer {
	const json = JSON.stringify(value ?? EMPTY_BLOCKNOTE_DOC)
	return gzipSync(Buffer.from(json, "utf8"))
}

export function decodeContent(
	blob: Uint8Array | Buffer | undefined | null,
): Record<string, unknown> {
	if (blob === undefined || blob === null) return cloneEmpty()
	const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
	if (buf.length === 0) return cloneEmpty()
	try {
		const text = gunzipSync(buf).toString("utf8")
		const parsed = JSON.parse(text)
		return isObject(parsed) ? parsed : cloneEmpty()
	} catch {
		return cloneEmpty()
	}
}

function cloneEmpty(): Record<string, unknown> {
	return structuredClone(EMPTY_BLOCKNOTE_DOC)
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

import { docCharLinks, docResLinks, documents, docVersions } from "./schema.ts"

type DocDbRow = typeof documents.$inferSelect

/**
 * Public document row shape exposed to the service. The on-disk
 * `draftContentBlob` column is decoded into a Tiptap JSON object so
 * callers never deal with the gzipped buffer.
 */
export type DocRow = Omit<DocDbRow, "draftContentBlob"> & {
	readonly draftContent: Record<string, unknown> | null
}

export type DocDbInsert = {
	readonly id: string
	readonly parentId: string | undefined
	readonly kind: "folder" | "document"
	readonly title: string
	readonly position: number
	readonly ts: number
}

export type DocDbPatch = Partial<{
	parentId: string | null
	title: string
	position: number
	draftTitle: string | null
	draftContent: unknown
	draftCharIds: readonly string[]
	draftResIds: readonly string[]
	draftUpdatedAt: number | null
	headVersionId: string | null
	searchText: string
	deletedAt: number | null
	updatedAt: number
}>

type DocVersionDbRow = typeof docVersions.$inferSelect

/** Public version row shape — `content` is always the decoded JSON. */
export type DocVersionRow = Omit<DocVersionDbRow, "contentBlob"> & {
	readonly content: Record<string, unknown>
}

/**
 * Lightweight version metadata for history listings — drops the
 * (potentially large) content payload so the history sidebar avoids
 * shipping every snapshot's body to the client.
 */
export type DocVersionMetaRow = Omit<DocVersionRow, "content">

export type DocVersionInsert = {
	readonly id: string
	readonly docId: string
	readonly versionNo: number
	readonly title: string
	readonly content: unknown
	readonly charIds: readonly string[]
	readonly resIds: readonly string[]
	readonly message: string
	readonly createdAt: number
}

export type DocSearchQuery = {
	readonly query?: string
	readonly parentId?: string | undefined
	readonly charIds?: readonly string[]
	readonly resIds?: readonly string[]
	readonly trashed: boolean
	readonly page: number
	readonly size: number
}

export type DocSearchPage = {
	readonly rows: readonly DocRow[]
	readonly total: number
}

/**
 * Drizzle query layer for the document module. Owns:
 * - documents tree CRUD + soft-delete patching
 * - draft column patching
 * - version history insert / read
 * - char / res link projection rewrites (for HEAD-snapshot search)
 */
export type DocRepository = {
	findById(id: string): DocRow
	findByIdOrUndefined(id: string): DocRow | undefined
	listChildren(parentId: string | undefined): readonly DocRow[]
	listAllLive(): readonly DocRow[]
	insert(input: DocDbInsert): void
	patch(id: string, fields: DocDbPatch): void
	remove(id: string): void
	maxPositionAt(parentId: string | undefined): number

	insertVersion(input: DocVersionInsert): void
	listVersionMetas(docId: string): readonly DocVersionMetaRow[]
	findVersionById(versionId: string): DocVersionRow | undefined
	maxVersionNo(docId: string): number

	/**
	 * Atomically commit a new version and promote it to HEAD:
	 * insert the version row, patch the document row, and rewrite the
	 * char/res link tables. Either all steps succeed or none do.
	 */
	commitVersion(input: {
		docId: string
		version: DocVersionInsert
		patch: DocDbPatch
		charIds: readonly string[]
		resIds: readonly string[]
	}): void

	rewriteCharLinks(docId: string, charIds: readonly string[]): void
	rewriteResLinks(docId: string, resIds: readonly string[]): void

	moveMany(
		moves: ReadonlyArray<{
			readonly id: string
			readonly parentId?: string | undefined
			readonly position: number
		}>,
		ts: number,
	): void

	search(query: DocSearchQuery): DocSearchPage
}

export function buildDocumentRepository(client: DbClient): DocRepository {
	const rawFindById = buildFindById<DocDbRow>(client, documents, "document")
	const rawPatch = buildPatch<DocDbPatch>(client, documents)
	const remove = buildRemove(client, documents)

	function findById(id: string): DocRow {
		return decodeDocumentRow(rawFindById(id))
	}

	function patch(id: string, fields: DocDbPatch): void {
		rawPatch(id, encodeDocumentPatch(fields))
	}

	function findByIdOrUndefined(id: string): DocRow | undefined {
		const row = client
			.select()
			.from(documents)
			.where(eq(documents.id, id))
			.get()
		return row === undefined ? undefined : decodeDocumentRow(row)
	}

	function listChildren(parentId: string | undefined): readonly DocRow[] {
		const where =
			parentId === undefined
				? isNull(documents.parentId)
				: eq(documents.parentId, parentId)
		return client
			.select()
			.from(documents)
			.where(and(where, isNull(documents.deletedAt)))
			.orderBy(documents.position, documents.createdAt)
			.all()
			.map(decodeDocumentRow)
	}

	function listAllLive(): readonly DocRow[] {
		return client
			.select()
			.from(documents)
			.where(isNull(documents.deletedAt))
			.orderBy(documents.position)
			.all()
			.map(decodeDocumentRow)
	}

	function insert(input: DocDbInsert): void {
		client
			.insert(documents)
			.values({
				id: input.id,
				parentId: input.parentId ?? null,
				kind: input.kind,
				title: input.title,
				position: input.position,
				draftCharIds: [],
				draftResIds: [],
				createdAt: input.ts,
				updatedAt: input.ts,
			})
			.run()
	}

	function maxPositionAt(parentId: string | undefined): number {
		const where =
			parentId === undefined
				? isNull(documents.parentId)
				: eq(documents.parentId, parentId)
		const row = client
			.select({ value: sql<number | null>`MAX(${documents.position})` })
			.from(documents)
			.where(and(where, isNull(documents.deletedAt)))
			.get()
		return row?.value ?? -1
	}

	function insertVersion(input: DocVersionInsert): void {
		client
			.insert(docVersions)
			.values({
				id: input.id,
				docId: input.docId,
				versionNo: input.versionNo,
				title: input.title,
				contentBlob: encodeContent(input.content),
				charIds: input.charIds,
				resIds: input.resIds,
				message: input.message,
				createdAt: input.createdAt,
			})
			.run()
	}

	function listVersionMetas(docId: string): readonly DocVersionMetaRow[] {
		return client
			.select({
				id: docVersions.id,
				docId: docVersions.docId,
				versionNo: docVersions.versionNo,
				title: docVersions.title,
				charIds: docVersions.charIds,
				resIds: docVersions.resIds,
				message: docVersions.message,
				createdAt: docVersions.createdAt,
			})
			.from(docVersions)
			.where(eq(docVersions.docId, docId))
			.orderBy(desc(docVersions.versionNo))
			.all()
	}

	function findVersionById(versionId: string): DocVersionRow | undefined {
		const row = client
			.select()
			.from(docVersions)
			.where(eq(docVersions.id, versionId))
			.get()
		return row === undefined ? undefined : decodeVersionRow(row)
	}

	function maxVersionNo(docId: string): number {
		const row = client
			.select({ value: sql<number | null>`MAX(${docVersions.versionNo})` })
			.from(docVersions)
			.where(eq(docVersions.docId, docId))
			.get()
		return row?.value ?? 0
	}

	function commitVersion(input: {
		docId: string
		version: DocVersionInsert
		patch: DocDbPatch
		charIds: readonly string[]
		resIds: readonly string[]
	}): void {
		const { docId, version, patch: patchFields, charIds, resIds } = input
		client.transaction((tx) => {
			tx.insert(docVersions)
				.values({
					id: version.id,
					docId: version.docId,
					versionNo: version.versionNo,
					title: version.title,
					contentBlob: encodeContent(version.content),
					charIds: version.charIds,
					resIds: version.resIds,
					message: version.message,
					createdAt: version.createdAt,
				})
				.run()
			tx.update(documents)
				.set(encodeDocumentPatch(patchFields))
				.where(eq(documents.id, docId))
				.run()
			tx.delete(docCharLinks).where(eq(docCharLinks.docId, docId)).run()
			for (const charId of new Set(charIds)) {
				tx.insert(docCharLinks).values({ docId, charId }).run()
			}
			tx.delete(docResLinks).where(eq(docResLinks.docId, docId)).run()
			for (const resId of new Set(resIds)) {
				tx.insert(docResLinks).values({ docId, resId }).run()
			}
		})
	}

	function rewriteCharLinks(docId: string, charIds: readonly string[]): void {
		client.transaction((tx) => {
			tx.delete(docCharLinks).where(eq(docCharLinks.docId, docId)).run()
			for (const charId of new Set(charIds)) {
				tx.insert(docCharLinks).values({ docId, charId }).run()
			}
		})
	}

	function rewriteResLinks(docId: string, resIds: readonly string[]): void {
		client.transaction((tx) => {
			tx.delete(docResLinks).where(eq(docResLinks.docId, docId)).run()
			for (const resId of new Set(resIds)) {
				tx.insert(docResLinks).values({ docId, resId }).run()
			}
		})
	}

	function moveMany(
		moves: ReadonlyArray<{
			readonly id: string
			readonly parentId?: string | undefined
			readonly position: number
		}>,
		ts: number,
	): void {
		client.transaction((tx) => {
			for (const m of moves) {
				tx.update(documents)
					.set({
						parentId: m.parentId ?? null,
						position: m.position,
						updatedAt: ts,
					})
					.where(eq(documents.id, m.id))
					.run()
			}
		})
	}

	function search(q: DocSearchQuery): DocSearchPage {
		const where = buildSearchWhere(q)
		const totalRow = client
			.select({ total: count() })
			.from(documents)
			.where(where)
			.get()
		const total = totalRow?.total ?? 0
		const rows = client
			.select()
			.from(documents)
			.where(where)
			.orderBy(desc(documents.updatedAt), desc(documents.id))
			.limit(q.size)
			.offset((q.page - 1) * q.size)
			.all()
		return { rows: rows.map(decodeDocumentRow), total }
	}

	function buildSearchWhere(q: DocSearchQuery): SQL | undefined {
		const clauses: SQL[] = []
		clauses.push(
			q.trashed ? isNotNull(documents.deletedAt) : isNull(documents.deletedAt),
		)
		if (q.parentId !== undefined) {
			clauses.push(eq(documents.parentId, q.parentId))
		}
		if (q.query !== undefined && q.query.length > 0) {
			const titleOrContent = sql`(${likeContainsLower(documents.title, q.query)} OR ${likeContainsLower(documents.searchText, q.query)})`
			clauses.push(titleOrContent)
		}
		if (q.charIds && q.charIds.length > 0) {
			for (const charId of q.charIds) {
				clauses.push(
					sql`EXISTS (SELECT 1 FROM ${docCharLinks} WHERE ${docCharLinks.docId} = ${documents.id} AND ${docCharLinks.charId} = ${charId})`,
				)
			}
		}
		if (q.resIds && q.resIds.length > 0) {
			for (const resId of q.resIds) {
				clauses.push(
					sql`EXISTS (SELECT 1 FROM ${docResLinks} WHERE ${docResLinks.docId} = ${documents.id} AND ${docResLinks.resId} = ${resId})`,
				)
			}
		}
		return clauses.length === 1 ? clauses[0] : and(...clauses)
	}

	return {
		findById,
		findByIdOrUndefined,
		listChildren,
		listAllLive,
		insert,
		patch,
		remove,
		maxPositionAt,
		insertVersion,
		listVersionMetas,
		findVersionById,
		maxVersionNo,
		commitVersion,
		rewriteCharLinks,
		rewriteResLinks,
		moveMany,
		search,
	}
}

function decodeDocumentRow(row: DocDbRow): DocRow {
	const { draftContentBlob, ...rest } = row
	return {
		...rest,
		draftContent:
			draftContentBlob !== null && draftContentBlob !== undefined
				? decodeContent(draftContentBlob)
				: null,
	}
}

function decodeVersionRow(row: DocVersionDbRow): DocVersionRow {
	const { contentBlob, ...rest } = row
	return {
		...rest,
		content: decodeContent(contentBlob),
	}
}

/**
 * Translate the public `DocDbPatch` API onto the actual storage
 * column: any caller-supplied `draftContent` is gzipped into
 * `draftContentBlob`. `null` clears the column (used by `discardDraft`
 * and `commitDraft`); `undefined` leaves it intact.
 */
function encodeDocumentPatch(fields: DocDbPatch): Record<string, unknown> {
	if (!("draftContent" in fields)) return fields
	const { draftContent, ...rest } = fields
	if (draftContent === null) {
		return { ...rest, draftContentBlob: null }
	}
	if (draftContent === undefined) {
		return rest
	}
	return {
		...rest,
		draftContentBlob: encodeContent(draftContent),
	}
}

/**
 * Which of the given document ids still exist as live documents (not
 * soft-deleted, not folders). Preserves the input order. Shared by
 * domains that aggregate over documents (usage stats).
 */
export function filterExistingDocumentIds(
	client: DbClient,
	ids: readonly string[],
): readonly string[] {
	if (ids.length === 0) return []
	const rows = client
		.select({ id: documents.id })
		.from(documents)
		.where(
			and(
				inArray(documents.id, ids),
				isNull(documents.deletedAt),
				eq(documents.kind, "document"),
			),
		)
		.all()
	const existing = new Set(rows.map((row) => row.id))
	return ids.filter((id) => existing.has(id))
}
