import type {
	DocAdoptVersionInput,
	DocCommitInput,
	DocCreateInput,
	DocDetailPageOutput,
	DocDraft,
	DocDraftPatchInput,
	DocMoveBatchInput,
	DocNode,
	DocNodeView,
	DocRenameInput,
	DocSearchInput,
	DocSearchRow,
	DocVersion,
	DocVersionMeta,
} from "@hoardodile/schemas"
import {
	MAX_DOC_CONTENT_TEXT_LENGTH,
	MAX_DOC_SNIPPET_LENGTH,
	MAX_PAGE_SIZE,
} from "@hoardodile/schemas"
import { conflict, invalid, notFound } from "@hoardodile/shared"
import { filterExistingCharacterIds } from "src/domain/char/repo.ts"
import { filterExistingResourceIds } from "src/domain/res/repo.ts"
import type { TraceActionDetail, UserAction } from "src/domain/trace/actions.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import {
	applyPageBounds,
	buildSoftDeleteOps,
	type ClockDeps,
	filterDefined,
	resolveClock,
	wrapAsync,
} from "src/infra/service.ts"
import {
	buildDocumentRepository,
	type DocRow,
	type DocVersionMetaRow,
	type DocVersionRow,
} from "./repo.ts"

/**
 * Flatten a BlockNote v2 document into plain text for the search
 * projection column.
 */
function extractPlainText(node: unknown): string {
	const buf: string[] = []
	walk(node, buf)
	const joined = buf.join(" ").replace(/\s+/g, " ").trim()
	return joined.length > 80_000 ? joined.slice(0, 80_000) : joined
}

const PROP_KEYS = ["searchText", "charId", "resId", "fallbackName"] as const
const RECURSE_KEYS = ["blocks", "content", "children"] as const

function walk(node: unknown, buf: string[]): void {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, buf)
		return
	}
	if (!isRecord(node)) return
	const text = node.text
	if (typeof text === "string") {
		buf.push(text)
	}
	const props = node.props
	if (isRecord(props)) {
		for (const key of PROP_KEYS) {
			const v = props[key]
			if (typeof v === "string" && v.length > 0) buf.push(v)
		}
	}
	for (const key of RECURSE_KEYS) {
		const v = node[key]
		if (Array.isArray(v)) {
			for (const child of v) walk(child, buf)
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

/**
 * Count plain-text characters in a BlockNote v2 document without
 * building a string. Walks the tree summing `.text` field lengths —
 * close enough to the frontend ProseMirror `textBetween` count for
 * validation at the 1M-character scale, and avoids any allocation.
 */
function countPlainText(node: unknown): number {
	let total = 0
	function visit(n: unknown): void {
		if (Array.isArray(n)) {
			for (const child of n) visit(child)
			return
		}
		if (!isRecord(n)) return
		if (typeof n.text === "string") {
			total += n.text.length
		}
		for (const key of RECURSE_KEYS) {
			const v = n[key]
			if (Array.isArray(v)) {
				for (const child of v) visit(child)
			}
		}
	}
	visit(node)
	return total
}

/**
 * Extract referenced character and resource ids from a BlockNote document
 * body. Walks the same keys as the plain-text extractor but returns stable
 * id arrays instead of text. Duplicates are removed while preserving first
 * occurrence order; invalid / empty ids are ignored.
 */
function extractDocEntityIds(
	content: unknown,
): readonly [readonly string[], readonly string[]] {
	const charIds = new Set<string>()
	const resIds = new Set<string>()
	const charBuf: string[] = []
	const resBuf: string[] = []

	function visit(node: unknown): void {
		if (Array.isArray(node)) {
			for (const child of node) visit(child)
			return
		}
		if (!isRecord(node)) return

		const type = node.type
		const props = node.props
		if (type === "charChip" && isRecord(props)) {
			const id = props.charId
			if (typeof id === "string" && id.length > 0 && !charIds.has(id)) {
				charIds.add(id)
				charBuf.push(id)
			}
		} else if (type === "resCard" && isRecord(props)) {
			const id = props.resId
			if (typeof id === "string" && id.length > 0 && !resIds.has(id)) {
				resIds.add(id)
				resBuf.push(id)
			}
		}

		for (const key of RECURSE_KEYS) {
			const v = node[key]
			if (Array.isArray(v)) {
				for (const child of v) visit(child)
			}
		}
	}
	visit(content)
	return [charBuf, resBuf]
}

/**
 * Drop character / resource ids that do not exist or have been soft-deleted.
 * Delegates the existence rules to the owning domains' repositories and
 * preserves the original order of the surviving ids.
 */
function filterExistingEntityIds(
	db: SqliteDb,
	charIds: readonly string[],
	resIds: readonly string[],
): readonly [readonly string[], readonly string[]] {
	return [
		filterExistingCharacterIds(db, charIds),
		filterExistingResourceIds(db, resIds),
	]
}

export type DocServiceDeps = ClockDeps & {
	readonly db: SqliteDb
	/**
	 * Optional listener for discrete user actions (create, commit, delete).
	 * Wired to the trace domain at the composition root. Only document
	 * nodes (kind `document`) are reported; folders are structural.
	 */
	readonly onUserAction?: (action: UserAction) => void
}

export type DocSearchResult = {
	readonly rows: readonly DocSearchRow[]
	readonly total: number
	readonly page: number
	readonly size: number
}

/**
 * Behaviour contract for the document module.
 *
 * Tree:
 * - Single implicit root (parentId === undefined). Frontend never renders
 *   it.
 * - `moveBatch` is the only mutation that touches parentId/position; tree
 *   moves NEVER create version rows.
 *
 * Drafts:
 * - Every document carries a draft. Editing patches `draft_*` columns;
 *   commit promotes the draft into a new version row, refreshes search
 *   indexes, and clears the draft.
 *
 * History:
 * - Append-only. `adoptVersionAsDraft` is the only "rewind" path: copies a
 *   historical version into the current draft so the user can re-commit.
 *
 * Folders:
 * - Have no draft / version state. Title rename is a direct row update.
 */
export type DocService = {
	listChildren(parentId: string | undefined): Promise<readonly DocNode[]>
	tree(): Promise<readonly DocNode[]>
	detail(id: string): Promise<DocNode>
	/**
	 * Bulk read for the detail page — packs node metadata, the
	 * editor-ready draft (with a HEAD-version fallback when the draft is
	 * empty), and the lightweight version history into one round-trip.
	 */
	nodeView(id: string): Promise<DocNodeView>
	/**
	 * Bootstrap payload for the document detail route: the full live tree
	 * plus the active node's view in one call.
	 */
	detailPage(id: string): Promise<DocDetailPageOutput>

	createNode(input: DocCreateInput): Promise<DocNode>
	renameNode(input: DocRenameInput): Promise<DocNode>
	softDelete(id: string): Promise<DocNode>
	restore(id: string): Promise<DocNode>
	hardDelete(id: string): Promise<void>

	getDraft(docId: string): Promise<DocDraft>
	patchDraft(input: DocDraftPatchInput): Promise<DocDraft>
	discardDraft(docId: string): Promise<DocDraft>
	commitDraft(input: DocCommitInput): Promise<DocVersion>

	listVersions(docId: string): Promise<readonly DocVersionMeta[]>
	getVersion(versionId: string): Promise<DocVersion>
	adoptVersionAsDraft(input: DocAdoptVersionInput): Promise<DocDraft>

	moveBatch(input: DocMoveBatchInput): Promise<void>
	search(input: DocSearchInput): Promise<DocSearchResult>
}

export function createDocumentService(deps: DocServiceDeps): DocService {
	const repo = buildDocumentRepository(deps.db)
	const { now, newId } = resolveClock(deps)

	function recordUserAction(
		action: UserAction["action"],
		node: DocRow,
		detail?: TraceActionDetail,
	): void {
		if (node.kind !== "document") return
		deps.onUserAction?.({
			action,
			entityType: "document",
			entityId: node.id,
			entityName: node.title,
			detail,
		})
	}

	function listChildren(parentId: string | undefined): readonly DocNode[] {
		return repo.listChildren(parentId).map(rowToNode)
	}

	function tree(): readonly DocNode[] {
		return repo.listAllLive().map(rowToNode)
	}

	function detail(id: string): DocNode {
		return rowToNode(repo.findById(id))
	}

	function createNode(input: DocCreateInput): DocNode {
		if (input.parentId !== undefined) {
			// Validate the parent exists (and is live) but allow either kind —
			// a document may host child folders or child documents.
			repo.findById(input.parentId)
		}
		const id = newId()
		const ts = now()
		const position = input.position ?? repo.maxPositionAt(input.parentId) + 1
		repo.insert({
			id,
			parentId: input.parentId,
			kind: input.kind,
			title: input.title,
			position,
			ts,
		})
		const node = rowToNode(repo.findById(id))
		recordUserAction("document.create", repo.findById(id))
		return node
	}

	function renameNode(input: DocRenameInput): DocNode {
		repo.findById(input.id)
		repo.patch(input.id, { title: input.title, updatedAt: now() })
		return rowToNode(repo.findById(input.id))
	}

	const softDeleteOps = buildSoftDeleteOps({
		entity: "document",
		repo,
		mapper: rowToNode,
		now,
	})

	function softDelete(id: string): DocNode {
		const node = softDeleteOps.softDelete(id)
		recordUserAction("document.softDelete", repo.findById(id))
		return node
	}

	function restore(id: string): DocNode {
		const node = softDeleteOps.restore(id)
		recordUserAction("document.restore", repo.findById(id))
		return node
	}

	function hardDelete(id: string): void {
		const row = repo.findById(id)
		if (row.deletedAt === null) {
			throw conflict(
				"document.hard_delete_requires_trash",
				`document ${id} must be soft-deleted first`,
				{ id },
			)
		}
		// Cascade FKs handle versions / links rows.
		repo.remove(id)
		recordUserAction("document.hardDelete", row)
	}

	// --- Drafts ---

	function loadHeadContent(row: DocRow): Record<string, unknown> | undefined {
		if (row.headVersionId === null) return undefined
		const head = repo.findVersionById(row.headVersionId)
		return head?.content
	}

	function draftView(row: DocRow): DocDraft {
		return rowToDraft(row, loadHeadContent(row))
	}

	function getDraft(docId: string): DocDraft {
		const row = repo.findById(docId)
		assertDocument(row)
		return draftView(row)
	}

	function patchDraft(input: DocDraftPatchInput): DocDraft {
		const row = repo.findById(input.id)
		assertDocument(row)
		// Optimistic-concurrency guard for offline sync pushes: the caller
		// pins the draft timestamp it based its edits on, so a stale offline
		// client cannot silently overwrite a newer remote draft.
		if (
			input.expectedUpdatedAt !== undefined &&
			input.expectedUpdatedAt !== (row.draftUpdatedAt ?? row.updatedAt)
		) {
			throw conflict(
				"document.draft_conflict",
				"Remote draft changed since the offline edits were based on",
			)
		}
		if (
			input.content !== undefined &&
			countPlainText(input.content) > MAX_DOC_CONTENT_TEXT_LENGTH
		) {
			throw invalid(
				"CONTENT_TOO_LARGE",
				"Document content exceeds maximum size",
			)
		}
		const ts = now()
		let charIds = input.charIds
		let resIds = input.resIds
		if (input.content !== undefined) {
			const [extractedCharIds, extractedResIds] = extractDocEntityIds(
				input.content,
			)
			const [filteredCharIds, filteredResIds] = filterExistingEntityIds(
				deps.db,
				extractedCharIds,
				extractedResIds,
			)
			charIds = [...filteredCharIds]
			resIds = [...filteredResIds]
		}
		const fields = filterDefined({
			draftTitle: input.title,
			draftContent: input.content,
			draftCharIds: charIds,
			draftResIds: resIds,
		})
		repo.patch(input.id, {
			...fields,
			draftUpdatedAt: ts,
			updatedAt: ts,
		})
		return draftView(repo.findById(input.id))
	}

	function discardDraft(docId: string): DocDraft {
		const row = repo.findById(docId)
		assertDocument(row)
		const ts = now()
		repo.patch(docId, {
			draftTitle: null,
			draftContent: null,
			draftCharIds: [],
			draftResIds: [],
			draftUpdatedAt: null,
			updatedAt: ts,
		})
		return draftView(repo.findById(docId))
	}

	function commitDraft(input: DocCommitInput): DocVersion {
		const row = repo.findById(input.id)
		assertDocument(row)
		const versionId = newId()
		const ts = now()
		const versionNo = repo.maxVersionNo(input.id) + 1
		const title = row.draftTitle ?? row.title
		const content = row.draftContent ?? { type: "doc", content: [] }
		const charIds = row.draftCharIds
		const resIds = row.draftResIds
		const searchText = extractPlainText(content)

		repo.commitVersion({
			docId: input.id,
			version: {
				id: versionId,
				docId: input.id,
				versionNo,
				title,
				content,
				charIds,
				resIds,
				message: input.message ?? "",
				createdAt: ts,
			},
			patch: {
				title,
				headVersionId: versionId,
				searchText,
				draftTitle: null,
				draftContent: null,
				draftCharIds: [],
				draftResIds: [],
				draftUpdatedAt: null,
				updatedAt: ts,
			},
			charIds,
			resIds,
		})
		const version = rowToVersion(
			repo.findVersionById(versionId) ?? throwMissingVersion(versionId),
		)
		recordUserAction("document.commit", repo.findById(input.id), {
			versionNo: version.versionNo,
		})
		return version
	}

	function listVersions(docId: string): readonly DocVersionMeta[] {
		repo.findById(docId)
		return repo.listVersionMetas(docId).map(rowToVersionMeta)
	}

	function getVersion(versionId: string): DocVersion {
		const row = repo.findVersionById(versionId)
		if (row === undefined) throwMissingVersion(versionId)
		return rowToVersion(row)
	}

	function adoptVersionAsDraft(input: DocAdoptVersionInput): DocDraft {
		const docRow = repo.findById(input.docId)
		assertDocument(docRow)
		const version = repo.findVersionById(input.versionId)
		if (version === undefined) throwMissingVersion(input.versionId)
		if (version.docId !== input.docId) {
			throw invalid(
				"document.version_doc_mismatch",
				`version ${input.versionId} does not belong to document ${input.docId}`,
				{ versionId: input.versionId, docId: input.docId },
			)
		}
		const ts = now()
		repo.patch(input.docId, {
			draftTitle: version.title,
			draftContent: version.content,
			draftCharIds: version.charIds,
			draftResIds: version.resIds,
			draftUpdatedAt: ts,
			updatedAt: ts,
		})
		return draftView(repo.findById(input.docId))
	}

	// --- Tree moves ---

	function moveBatch(input: DocMoveBatchInput): void {
		// Build target parent map from the patch + existing tree, then
		// validate no node winds up as its own ancestor.
		const live = repo.listAllLive()
		const parentByNode = new Map<string, string | undefined>()
		for (const r of live) {
			parentByNode.set(r.id, r.parentId ?? undefined)
		}
		for (const m of input.moves) {
			if (!parentByNode.has(m.id)) {
				throw notFound("document.not_found", `document ${m.id} not found`, {
					id: m.id,
				})
			}
			if (m.parentId !== undefined && !parentByNode.has(m.parentId)) {
				throw notFound("document.not_found", `parent ${m.parentId} not found`, {
					id: m.parentId,
				})
			}
			parentByNode.set(m.id, m.parentId)
		}
		assertNoCycles(parentByNode)
		const ts = now()
		repo.moveMany(input.moves, ts)
	}

	// --- Search ---

	function search(input: DocSearchInput): DocSearchResult {
		const { page, size } = applyPageBounds(input, MAX_PAGE_SIZE)
		const result = repo.search({
			query: input.query,
			parentId: input.parentId,
			charIds: input.charIds,
			resIds: input.resIds,
			trashed: input.trashed === true,
			page,
			size,
		})
		return {
			rows: result.rows.map(rowToSearchRow),
			total: result.total,
			page,
			size,
		}
	}

	// --- Helpers ---

	function assertDocument(row: DocRow): void {
		if (row.kind !== "document") {
			throw invalid(
				"document.kind_mismatch",
				`node ${row.id} is a folder; draft / version operations require a document`,
				{ id: row.id, kind: row.kind },
			)
		}
	}

	function buildNodeView(row: DocRow): DocNodeView {
		const node = rowToNode(row)
		if (row.kind !== "document") {
			return {
				node,
				draft: undefined,
				versions: [],
			}
		}
		return {
			node,
			draft: draftView(row),
			versions: repo.listVersionMetas(row.id).map(rowToVersionMeta),
		}
	}

	function nodeView(id: string): DocNodeView {
		return buildNodeView(repo.findById(id))
	}

	function detailPage(id: string): DocDetailPageOutput {
		return {
			tree: [...tree()],
			nodeView: buildNodeView(repo.findById(id)),
		}
	}

	return wrapAsync({
		listChildren,
		tree,
		detail,
		nodeView,
		detailPage,
		createNode,
		renameNode,
		softDelete,
		restore,
		hardDelete,
		getDraft,
		patchDraft,
		discardDraft,
		commitDraft,
		listVersions,
		getVersion,
		adoptVersionAsDraft,
		moveBatch,
		search,
	})
}

function rowToNode(row: DocRow): DocNode {
	const parentId = row.parentId ?? undefined
	const kind = row.kind === "folder" ? "folder" : "document"
	const title = kind === "document" ? (row.draftTitle ?? row.title) : row.title
	const base = {
		id: row.id,
		kind,
		title,
		position: row.position,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	} as const
	const withParent = parentId === undefined ? base : { ...base, parentId }
	return row.deletedAt !== null
		? { ...withParent, deletedAt: row.deletedAt }
		: withParent
}

function rowToSearchRow(row: DocRow): DocSearchRow {
	const node = rowToNode(row)
	const raw = row.searchText.trim()
	const snippet =
		raw.length > 0 ? raw.slice(0, MAX_DOC_SNIPPET_LENGTH) : undefined
	return snippet === undefined ? node : { ...node, snippet }
}

function rowToDraft(
	row: DocRow,
	headContent: Record<string, unknown> | undefined,
): DocDraft {
	const title = row.draftTitle ?? row.title
	const draftIsEmpty = row.draftContent === null
	// When the draft is empty, fall back to the HEAD version body so the
	// editor never blanks out a previously committed document. This is
	// the canonical "what the user expects to see when opening a doc"
	// state.
	const content =
		!draftIsEmpty && row.draftContent !== null
			? row.draftContent
			: (headContent ?? { type: "doc", content: [] })
	return {
		docId: row.id,
		title,
		content,
		charIds: [...row.draftCharIds],
		resIds: [...row.draftResIds],
		updatedAt: row.draftUpdatedAt ?? row.updatedAt,
	}
}

function rowToVersion(row: DocVersionRow): DocVersion {
	return {
		id: row.id,
		docId: row.docId,
		versionNo: row.versionNo,
		title: row.title,
		content: row.content,
		charIds: [...(row.charIds as readonly string[])],
		resIds: [...(row.resIds as readonly string[])],
		message: row.message,
		createdAt: row.createdAt,
	}
}

function rowToVersionMeta(row: DocVersionMetaRow): DocVersionMeta {
	return {
		id: row.id,
		docId: row.docId,
		versionNo: row.versionNo,
		title: row.title,
		charIds: [...(row.charIds as readonly string[])],
		resIds: [...(row.resIds as readonly string[])],
		message: row.message,
		createdAt: row.createdAt,
	}
}

function throwMissingVersion(versionId: string): never {
	throw notFound(
		"document_version.not_found",
		`document version ${versionId} not found`,
		{ id: versionId },
	)
}

function assertNoCycles(
	parentByNode: ReadonlyMap<string, string | undefined>,
): void {
	for (const [id] of parentByNode) {
		const seen = new Set<string>()
		let cur: string | undefined = parentByNode.get(id)
		while (cur !== undefined) {
			if (cur === id) {
				throw invalid(
					"document.move_cycle",
					`move would create a cycle starting at ${id}`,
					{ id },
				)
			}
			if (seen.has(cur)) break
			seen.add(cur)
			cur = parentByNode.get(cur)
		}
	}
}
