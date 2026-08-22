import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
	createResourceWithUploadMutation,
	invalidateResources,
} from "@/features/res/api"
import type { FileListEntry } from "./FileListEditor"
import { stageSingleFile } from "./upload"

export type BatchResourceSubmitOptions = {
	readonly entries: readonly FileListEntry[]
	readonly name: string
	readonly intro: string
	readonly sourceName: string
	readonly sourceUrl: string
	readonly contentPluginId: string | null
	readonly tagIds: readonly string[]
	readonly charIds: readonly string[]
	readonly selectedCollectionIds: readonly string[]
	readonly coverCrop?: CroppedImage
	readonly resolveResourceName: (
		name: string,
		useFilenameAsName: boolean,
		file: File,
	) => string
	readonly useFilenameAsName: boolean
	readonly attachToCollection: (
		colId: string,
		resId: string,
	) => Promise<unknown>
	readonly uploadCover?: (resId: string) => Promise<unknown>
	readonly onSuccess: () => void
	readonly onError: (message: string) => void
}

export type BatchResourceSubmitResult = {
	readonly submit: () => Promise<void>
	readonly isSubmitting: boolean
	readonly progress: number | undefined
}

/**
 * Creation order for a batch submit: the display (drag) order reversed.
 * The resource grid renders newest-first (`createdAt DESC`), so creating
 * the LAST displayed file first makes the batch appear in the user's
 * drag order — first dragged file first, second second, and so on.
 */
export function batchCreateOrder(
	entries: readonly FileListEntry[],
): readonly FileListEntry[] {
	return [...entries].reverse()
}

/**
 * Submit one resource per ordered file, creating them in
 * {@link batchCreateOrder} so the newest-first grid renders the batch in
 * the user's drag order. Each file is staged individually, then a
 * resource row is created for it. Attachments and cover are applied
 * per-created resource.
 */
export function useBatchResourceSubmit(
	opts: BatchResourceSubmitOptions,
): BatchResourceSubmitResult {
	const qc = useQueryClient()
	const createMut = useMutation(createResourceWithUploadMutation())
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [progress, setProgress] = useState<number | undefined>(undefined)

	async function submit(): Promise<void> {
		const ordered = batchCreateOrder(opts.entries)
		if (ordered.length === 0) return
		const files = ordered.map((e) => e.file)
		const grandTotal = totalOrderedUploadWeight(files)
		const trimmedName = opts.name.trim()

		try {
			setIsSubmitting(true)
			setProgress(0)

			for (let i = 0; i < ordered.length; i++) {
				const entry = ordered[i]
				if (entry === undefined) continue

				const prefix = cumulativeOrderedWeightsBefore(files, i)
				const { fileId } = await stageSingleFile({
					file: entry.file,
					onProgress: (p) => {
						if (p.total > 0 && grandTotal > 0) {
							setProgress((prefix + p.loaded) / grandTotal)
						}
					},
				})

				const resolvedName = opts.resolveResourceName(
					trimmedName,
					opts.useFilenameAsName,
					entry.file,
				)

				// Commit failure leaves the staged file in the pool; it will be
				// reclaimed at the next application startup.
				const created = await createMut.mutateAsync({
					files: [fileId],
					names: [entry.file.name],
					name: resolvedName,
					intro: opts.intro.length > 0 ? opts.intro : undefined,
					sourceName: opts.sourceName.trim() || undefined,
					sourceUrl: opts.sourceUrl.trim() || undefined,
					contentPluginId: opts.contentPluginId ?? undefined,
					tagIds: opts.tagIds,
					charIds: opts.charIds.length > 0 ? opts.charIds : undefined,
				})

				await finalizeResource(created.id, opts)
			}

			await invalidateResources(qc)
			opts.onSuccess()
		} catch (err) {
			const message = err instanceof Error ? err.message : "upload failed"
			opts.onError(message)
		} finally {
			setProgress(undefined)
			setIsSubmitting(false)
		}
	}

	return { submit, isSubmitting, progress }
}

async function finalizeResource(
	createdId: string,
	opts: BatchResourceSubmitOptions,
): Promise<void> {
	const tasks: Promise<unknown>[] = []
	for (const colId of opts.selectedCollectionIds) {
		tasks.push(opts.attachToCollection(colId, createdId))
	}
	if (opts.uploadCover !== undefined) {
		tasks.push(opts.uploadCover(createdId))
	}
	await Promise.all(tasks).catch(() => {
		// Per-attach / cover errors are non-fatal: the resource exists
		// and the user can still attach manually from the actions menu.
	})
}

function orderedFileWeight(file: File): number {
	return file.size > 0 ? file.size : 1
}

function cumulativeOrderedWeightsBefore(
	files: readonly File[],
	beforeIndex: number,
): number {
	let sum = 0
	for (let j = 0; j < beforeIndex && j < files.length; j++) {
		const f = files[j]
		if (f !== undefined) sum += orderedFileWeight(f)
	}
	return sum
}

function totalOrderedUploadWeight(files: readonly File[]): number {
	let sum = 0
	for (const f of files) sum += orderedFileWeight(f)
	return sum
}
