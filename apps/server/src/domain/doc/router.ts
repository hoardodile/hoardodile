import {
	docAdoptVersionInput,
	docCommitInput,
	docCreateInput,
	docDraft,
	docDraftPatchInput,
	docMoveBatchInput,
	docRenameInput,
	docSearchInput,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { DocService } from "./service.ts"

const idInput = z.object({ id: z.string().min(1) })
const parentIdInput = z.object({ parentId: z.string().min(1).optional() })
const versionIdInput = z.object({
	docId: z.string().min(1),
	versionId: z.string().min(1),
})
const docIdInput = z.object({ docId: z.string().min(1) })

/**
 * Document module tRPC sub-router. Includes:
 * - node: CRUD / tree / draft / commit / history / adopt history /
 *   batch move / search
 */
export function buildDocumentRouter(deps: { readonly documents: DocService }) {
	const documents = {
		listChildren: authedProcedure
			.input(parentIdInput)
			.query(({ input }) => deps.documents.listChildren(input.parentId)),
		tree: authedProcedure.query(() => deps.documents.tree()),
		detail: authedProcedure
			.input(idInput)
			.query(({ input }) => deps.documents.detail(input.id)),
		nodeView: authedProcedure
			.input(idInput)
			.query(({ input }) => deps.documents.nodeView(input.id)),
		create: writeProcedure
			.input(docCreateInput)
			.mutation(({ input }) => deps.documents.createNode(input)),
		rename: writeProcedure
			.input(docRenameInput)
			.mutation(({ input }) => deps.documents.renameNode(input)),
		softDelete: writeProcedure
			.input(idInput)
			.mutation(({ input }) => deps.documents.softDelete(input.id)),
		restore: writeProcedure
			.input(idInput)
			.mutation(({ input }) => deps.documents.restore(input.id)),
		hardDelete: writeProcedure
			.input(idInput)
			.mutation(({ input }) => deps.documents.hardDelete(input.id)),

		getDraft: authedProcedure
			.input(idInput)
			.query(({ input }) => deps.documents.getDraft(input.id)),
		patchDraft: writeProcedure
			.input(docDraftPatchInput)
			.mutation(({ input }) => deps.documents.patchDraft(input)),
		discardDraft: writeProcedure
			.input(idInput)
			.output(docDraft)
			.mutation(({ input }) => deps.documents.discardDraft(input.id)),
		commitDraft: writeProcedure
			.input(docCommitInput)
			.mutation(({ input }) => deps.documents.commitDraft(input)),

		listVersions: authedProcedure
			.input(docIdInput)
			.query(({ input }) => deps.documents.listVersions(input.docId)),
		getVersion: authedProcedure
			.input(versionIdInput)
			.query(({ input }) => deps.documents.getVersion(input.versionId)),
		adoptVersionAsDraft: writeProcedure
			.input(docAdoptVersionInput)
			.mutation(({ input }) => deps.documents.adoptVersionAsDraft(input)),

		moveBatch: writeProcedure
			.input(docMoveBatchInput)
			.mutation(({ input }) => deps.documents.moveBatch(input)),

		search: authedProcedure
			.input(docSearchInput)
			.query(({ input }) => deps.documents.search(input)),
	}

	return router(documents)
}

export type DocRouter = ReturnType<typeof buildDocumentRouter>
