/**
 * Write the official demo catalog into a live storage root through domain
 * services. Manifest at `{STORAGE_ROOT}/local/demo-seed.json` makes
 * in-progress reruns crash-safe.
 */

import { createReadStream } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { Readable } from "node:stream"
import { populatedCover } from "@hoardodile/schemas"
import { isDomainError } from "@hoardodile/shared"
import { hashPassword } from "src/domain/auth/password.ts"
import { getAuthRow, setAuthRow } from "src/domain/auth/repo.ts"
import {
	catalogFacets,
	catalogMedia,
	cats,
	chars,
	collections,
	comments,
	docs,
	FILE_PLUGIN_ID,
	fileResources,
	GALLERY_PLUGIN_ID,
	type GalleryFacet,
	galleryPluginPin,
	hierarchyType,
	type LocalTextFile,
	parentRules,
	relationshipType,
	resources,
	siblingPairs,
	syncDevice,
	tags,
	traits,
} from "./catalog.ts"
import {
	type DownloadedFile,
	type DownloadOptions,
	resolveMedia,
} from "./download.ts"
import {
	emptySeedManifest,
	readSeedManifestFromRoot,
	type SeedManifest,
	writeSeedManifestToRoot,
} from "./manifest.ts"
import { assertUnmixedLibrary, readMixedSnapshot } from "./mixed.ts"
import type { SeedRuntime } from "./runtime.ts"
import { writeCenteredSquareJpeg } from "./square-jpeg.ts"

export type FillOptions = DownloadOptions

function writeManifest(rt: SeedRuntime, manifest: SeedManifest): void {
	writeSeedManifestToRoot(rt.paths.root, manifest)
}

function log(message: string): void {
	process.stdout.write(`${message}\n`)
}

function isNotFound(err: unknown): boolean {
	return isDomainError(err) && err.code === "NOT_FOUND"
}

function warnCleanup(label: string, err: unknown): void {
	if (isNotFound(err)) return
	const message = err instanceof Error ? err.message : String(err)
	log(`seed: cleanup ${label}: ${message}`)
}

async function purgeSoftThenHard(
	label: string,
	soft: () => Promise<unknown>,
	hard: () => Promise<unknown>,
): Promise<void> {
	try {
		await soft()
	} catch (err) {
		warnCleanup(`${label} softDelete`, err)
	}
	try {
		await hard()
	} catch (err) {
		warnCleanup(`${label} hardDelete`, err)
	}
}

async function cleanupManifest(
	rt: SeedRuntime,
	manifest: SeedManifest,
): Promise<void> {
	log("seed: removing previous demo entities")
	for (const id of [...manifest.danmaku].reverse()) {
		try {
			await rt.danmaku.delete({ id })
		} catch (err) {
			warnCleanup(`danmaku ${id}`, err)
		}
	}
	for (const id of [...manifest.comments].reverse()) {
		await purgeSoftThenHard(
			`comment ${id}`,
			() => rt.comments.softDelete(id),
			() => rt.comments.hardDelete(id),
		)
	}
	for (const id of [...manifest.syncDevices].reverse()) {
		try {
			await rt.sync.deviceRemove(id)
		} catch (err) {
			warnCleanup(`sync ${id}`, err)
		}
	}
	for (const row of [...manifest.docs].reverse()) {
		await purgeSoftThenHard(
			`doc ${row.id}`,
			() => rt.docs.softDelete(row.id),
			() => rt.docs.hardDelete(row.id),
		)
	}
	for (const row of [...manifest.collections].reverse()) {
		try {
			await rt.cols.forceDelete(row.id, row.name)
		} catch (err) {
			warnCleanup(`collection ${row.id}`, err)
		}
	}
	for (const row of [...manifest.resources].reverse()) {
		await purgeSoftThenHard(
			`resource ${row.id}`,
			() => rt.res.softDelete(row.id),
			() => rt.res.hardDelete(row.id),
		)
	}
	for (const id of [...manifest.relationshipEdges].reverse()) {
		try {
			await rt.relationships.deleteCharactership(id)
		} catch (err) {
			warnCleanup(`edge ${id}`, err)
		}
	}
	for (const row of [...manifest.relationshipTypes].reverse()) {
		try {
			await rt.relationships.forceDeleteType(row.id, row.name)
		} catch (err) {
			warnCleanup(`relationship type ${row.id}`, err)
		}
	}
	for (const row of [...manifest.chars].reverse()) {
		await purgeSoftThenHard(
			`char ${row.id}`,
			() => rt.chars.softDelete(row.id),
			() => rt.chars.hardDelete(row.id),
		)
	}
	for (const row of [...manifest.tags].reverse()) {
		try {
			await rt.tags.forceDelete(row.id, row.name)
		} catch (err) {
			warnCleanup(`tag ${row.id}`, err)
		}
	}
	for (const row of [...manifest.traits].reverse()) {
		try {
			await rt.traits.forceDelete(row.id, row.name)
		} catch (err) {
			warnCleanup(`trait ${row.id}`, err)
		}
	}
	for (const row of [...manifest.cats].reverse()) {
		try {
			await rt.cats.forceDelete(row.id, row.name)
		} catch (err) {
			warnCleanup(`category ${row.id}`, err)
		}
	}
}

function extOf(filename: string): string {
	const index = filename.lastIndexOf(".")
	if (index < 0) return ".jpg"
	const ext = filename.slice(index).toLowerCase()
	return ext.startsWith(".") ? ext : `.${ext}`
}

async function setCharacterAvatar(
	rt: SeedRuntime,
	charId: string,
	sourcePath: string,
): Promise<void> {
	await mkdir(rt.paths.local.tmp(), { recursive: true })
	const tmp = rt.paths.local.tmpFile(`seed-avatar-${charId}.jpg`)
	await writeCenteredSquareJpeg(sourcePath, tmp)
	try {
		await rt.chars.setImage(charId, "avatar", ".jpg", tmp)
	} finally {
		await rm(tmp, { force: true })
	}
}

function dateTraitRaw(parts: { y: number; m: number; d: number }): string {
	return JSON.stringify({ p: "AD", s: "+", y: parts.y, m: parts.m, d: parts.d })
}

function pageUrlOf(title: string): string {
	return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
}

function pinFields(def: object): { pinned?: boolean; color?: string } {
	const out: { pinned?: boolean; color?: string } = {}
	if ("pinned" in def && def.pinned === true) out.pinned = true
	if ("color" in def && typeof def.color === "string" && def.color.length > 0) {
		out.color = def.color
	}
	return out
}

async function stageFiles(
	rt: SeedRuntime,
	files: readonly DownloadedFile[],
): Promise<{ files: string[]; names: string[] }> {
	const ids: string[] = []
	const names: string[] = []
	for (const file of files) {
		const staged = await rt.uploads.stageSingleFile(
			file.filename,
			createReadStream(file.path),
		)
		ids.push(staged.fileId)
		names.push(file.filename)
	}
	return { files: ids, names }
}

async function stageTextFiles(
	rt: SeedRuntime,
	files: readonly LocalTextFile[],
): Promise<{ files: string[]; names: string[] }> {
	const ids: string[] = []
	const names: string[] = []
	for (const file of files) {
		const staged = await rt.uploads.stageSingleFile(
			file.filename,
			Readable.from([Buffer.from(file.body.text, "utf8")]),
		)
		ids.push(staged.fileId)
		names.push(file.filename)
	}
	return { files: ids, names }
}

function requireFile(
	files: ReadonlyMap<string, DownloadedFile>,
	title: string,
): DownloadedFile | undefined {
	return files.get(title)
}

/**
 * Fill STORAGE_ROOT with the official demo catalog. Returns created
 * gallery facets so the CLI can fail when a required search kind is missing.
 */
export async function fillDemoLibrary(
	rt: SeedRuntime,
	opts: FillOptions,
): Promise<readonly GalleryFacet[]> {
	const existing = readSeedManifestFromRoot(rt.paths.root)
	if (existing === undefined) {
		throw new Error(
			"seed: missing demo-seed sentinel; refusing to fill an unmarked library",
		)
	}
	assertUnmixedLibrary(
		readMixedSnapshot(rt.db.db, rt.hostDb.db, rt.paths.root),
		existing,
	)
	if (existing.status === "complete") {
		if (getAuthRow(rt.hostDb.db) === undefined) {
			setAuthRow(rt.hostDb.db, {
				hash: await hashPassword("demo"),
				updatedAt: Date.now(),
				weakPassword: true,
			})
		}
		log("seed: already seeded")
		return catalogFacets()
	}
	if (existing.status === "in-progress") {
		await cleanupManifest(rt, existing)
	}

	const manifest = emptySeedManifest()
	writeManifest(rt, manifest)

	setAuthRow(rt.hostDb.db, {
		hash: await hashPassword("demo"),
		updatedAt: Date.now(),
		weakPassword: true,
	})

	log("seed: downloading media")
	const resolved = await resolveMedia(catalogMedia(), opts)
	for (const warning of resolved.warnings) {
		log(`seed: skip ${warning.title}: ${warning.message}`)
	}
	const files = resolved.files

	log("seed: creating categories")
	const catIds: Record<string, string> = {}
	for (const [key, def] of Object.entries(cats)) {
		const row = await rt.cats.create({
			kind: def.kind,
			name: def.name.text,
			intro: def.intro.text,
			...pinFields(def),
		})
		catIds[key] = row.id
		manifest.cats.push({ id: row.id, name: row.name })
	}
	writeManifest(rt, manifest)

	log("seed: creating tags")
	const tagIds: Record<string, string> = {}
	for (const [key, def] of Object.entries(tags)) {
		const catId = catIds[def.cat]
		if (catId === undefined) throw new Error(`missing category ${def.cat}`)
		const row = await rt.tags.create({
			catId,
			name: def.name.text,
			intro: def.intro.text,
			...pinFields(def),
		})
		tagIds[key] = row.id
		manifest.tags.push({ id: row.id, name: row.name })
	}
	for (const pair of siblingPairs) {
		const badId = tagIds[pair.bad]
		const goodId = tagIds[pair.good]
		if (badId === undefined || goodId === undefined) continue
		await rt.tags.siblingRuleCreate({ badId, goodId })
	}
	for (const rule of parentRules) {
		const childId = tagIds[rule.child]
		const parentId = tagIds[rule.parent]
		if (childId === undefined || parentId === undefined) continue
		await rt.tags.parentRuleCreate({ childId, parentId })
	}
	writeManifest(rt, manifest)

	log("seed: creating traits")
	const traitIds: Record<string, string> = {}
	for (const [key, def] of Object.entries(traits)) {
		const row = await rt.traits.create({
			kind: def.kind,
			name: def.name.text,
			intro: def.intro.text,
			...pinFields(def),
		})
		traitIds[key] = row.id
		manifest.traits.push({ id: row.id, name: row.name })
	}
	writeManifest(rt, manifest)

	log("seed: creating characters")
	const charIds: Record<string, string> = {}
	for (const [key, def] of Object.entries(chars)) {
		const traitValues: Record<string, string> = {}
		const occupationId = traitIds.occupation
		const heightId = traitIds.height
		const weightId = traitIds.weight
		const birthdayId = traitIds.birthday
		if (occupationId !== undefined && def.traits.occupation !== undefined) {
			traitValues[occupationId] = def.traits.occupation.text
		}
		if (heightId !== undefined && def.traits.height !== undefined) {
			traitValues[heightId] = def.traits.height
		}
		if (weightId !== undefined && def.traits.weight !== undefined) {
			traitValues[weightId] = def.traits.weight
		}
		if (birthdayId !== undefined && def.traits.birthday !== undefined) {
			traitValues[birthdayId] = dateTraitRaw(def.traits.birthday)
		}
		const tagList = def.tagKeys
			.map((tagKey) => tagIds[tagKey])
			.filter((id): id is string => id !== undefined)
		const row = await rt.chars.create({
			name: def.name.text,
			intro: def.intro.text,
			tagIds: tagList,
			traitValues,
		})
		charIds[key] = row.id
		manifest.chars.push({ id: row.id, name: row.name })
		const avatar = requireFile(files, def.avatar.title)
		if (avatar !== undefined) {
			await setCharacterAvatar(rt, row.id, avatar.path)
		} else {
			log(`seed: character ${def.name.text} has no avatar file`)
		}
		if ("fullbody" in def && def.fullbody !== undefined) {
			const body = requireFile(files, def.fullbody.title)
			if (body !== undefined) {
				await rt.chars.setImage(
					row.id,
					"fullbody",
					extOf(body.filename),
					body.path,
				)
			}
		}
	}
	writeManifest(rt, manifest)

	log("seed: creating relationships")
	const relType = await rt.relationships.createType({
		name: relationshipType.name.text,
		selfLabel: relationshipType.selfLabel.text,
		targetLabel: relationshipType.targetLabel.text,
		intro: relationshipType.intro.text,
		kind: relationshipType.kind,
		...pinFields(relationshipType),
	})
	manifest.relationshipTypes.push({ id: relType.id, name: relType.name })
	for (const edge of relationshipType.edges) {
		const selfId = charIds[edge.self]
		const targetId = charIds[edge.target]
		if (selfId === undefined || targetId === undefined) continue
		const created = await rt.relationships.createCharactership({
			typeId: relType.id,
			selfId,
			targetId,
		})
		manifest.relationshipEdges.push(created.id)
	}
	const hierType = await rt.relationships.createType({
		name: hierarchyType.name.text,
		selfLabel: hierarchyType.selfLabel.text,
		targetLabel: hierarchyType.targetLabel.text,
		intro: hierarchyType.intro.text,
		kind: hierarchyType.kind,
		hierarchyFrom: hierarchyType.hierarchyFrom,
	})
	manifest.relationshipTypes.push({ id: hierType.id, name: hierType.name })
	for (const edge of hierarchyType.edges) {
		const selfId = charIds[edge.self]
		const targetId = charIds[edge.target]
		if (selfId === undefined || targetId === undefined) continue
		const created = await rt.relationships.createCharactership({
			typeId: hierType.id,
			selfId,
			targetId,
		})
		manifest.relationshipEdges.push(created.id)
	}
	writeManifest(rt, manifest)

	log("seed: creating file-plugin resources")
	const resIds: Record<string, string> = {}
	for (const [key, def] of Object.entries(fileResources)) {
		const staged = await stageTextFiles(rt, def.files)
		const tagList = def.tagKeys
			.map((tagKey) => tagIds[tagKey])
			.filter((id): id is string => id !== undefined)
		try {
			const row = await rt.res.create({
				name: def.name.text,
				intro: def.intro.text,
				contentPluginId: FILE_PLUGIN_ID,
				tagIds: tagList,
				files: staged.files,
				names: staged.names,
			})
			resIds[key] = row.id
			manifest.resources.push({ id: row.id, name: row.name })
			if ("trash" in def && def.trash === true) {
				await rt.res.softDelete(row.id)
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			log(`seed: failed to create ${def.name.text}: ${message}`)
		}
	}

	log("seed: creating resources")
	const createdFacets = new Set<GalleryFacet>()
	for (const [key, def] of Object.entries(resources)) {
		const downloaded: DownloadedFile[] = []
		for (const media of def.files) {
			const file = requireFile(files, media.title)
			if (file === undefined) {
				log(`seed: resource ${def.name.text} missing ${media.title}`)
				continue
			}
			downloaded.push(file)
		}
		if (downloaded.length === 0) {
			log(`seed: skip empty resource ${def.name.text}`)
			continue
		}
		const staged = await stageFiles(rt, downloaded)
		const tagList = def.tagKeys
			.map((tagKey) => tagIds[tagKey])
			.filter((id): id is string => id !== undefined)
		const charList = def.charKeys
			.map((charKey) => charIds[charKey])
			.filter((id): id is string => id !== undefined)
		try {
			const row = await rt.res.create({
				name: def.name.text,
				intro: def.intro.text,
				sourceName: def.sourceName.text,
				sourceUrl:
					downloaded[0]?.pageUrl ?? pageUrlOf(def.files[0]?.title ?? ""),
				contentPluginId: GALLERY_PLUGIN_ID,
				tagIds: tagList,
				charIds: charList,
				files: staged.files,
				names: staged.names,
			})
			resIds[key] = row.id
			manifest.resources.push({ id: row.id, name: row.name })
			createdFacets.add(def.facet)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			log(`seed: failed to create ${def.name.text}: ${message}`)
		}
	}
	writeManifest(rt, manifest)

	log("seed: pinning gallery plugin")
	rt.plugins.update(GALLERY_PLUGIN_ID, {
		pinned: galleryPluginPin.pinned,
		color: galleryPluginPin.color,
	})

	log("seed: creating collections")
	for (const def of Object.values(collections)) {
		const row = await rt.cols.create({
			name: def.name.text,
			intro: def.intro.text,
			...pinFields(def),
		})
		manifest.collections.push({ id: row.id, name: row.name })
		for (const resKey of def.resourceKeys) {
			const resId = resIds[resKey]
			if (resId === undefined) continue
			await rt.cols.attach(row.id, resId)
		}
	}
	writeManifest(rt, manifest)

	log("seed: creating documents")
	const folder = await rt.docs.createNode({
		kind: "folder",
		title: docs.folder.title.text,
	})
	manifest.docs.push({ id: folder.id, name: folder.title })
	const licenseDoc = await rt.docs.createNode({
		parentId: folder.id,
		kind: "document",
		title: docs.license.title.text,
	})
	manifest.docs.push({ id: licenseDoc.id, name: licenseDoc.title })
	const earthId = resIds.earthAlbum
	const marieId = charIds.marie
	await rt.docs.patchDraft({
		id: licenseDoc.id,
		title: docs.license.title.text,
		content: {
			version: 4,
			blocks: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "本库媒体来自维基共享资源与美国航天局。许可为公有领域，或需保留作者署名。",
						},
					],
				},
			],
		},
		charIds: marieId === undefined ? [] : [marieId],
		resIds: earthId === undefined ? [] : [earthId],
	})
	await rt.docs.commitDraft({ id: licenseDoc.id, message: "首次写入" })

	const notesDoc = await rt.docs.createNode({
		parentId: folder.id,
		kind: "document",
		title: docs.notes.title.text,
	})
	manifest.docs.push({ id: notesDoc.id, name: notesDoc.title })
	const noteBlocks: unknown[] = [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Cards attached to this page:" }],
		},
	]
	if (marieId !== undefined) {
		noteBlocks.push({
			type: "paragraph",
			content: [
				{
					type: "charChip",
					props: { charId: marieId, fallbackName: chars.marie.name.text },
				},
			],
		})
	}
	if (earthId !== undefined) {
		noteBlocks.push({
			type: "paragraph",
			content: [{ type: "resCard", props: { resId: earthId } }],
		})
	}
	await rt.docs.patchDraft({
		id: notesDoc.id,
		title: docs.notes.title.text,
		content: { version: 4, blocks: noteBlocks },
		charIds: marieId === undefined ? [] : [marieId],
		resIds: earthId === undefined ? [] : [earthId],
	})
	await rt.docs.commitDraft({ id: notesDoc.id, message: "first commit" })

	const walkDoc = await rt.docs.createNode({
		parentId: folder.id,
		kind: "document",
		title: docs.walk.title.text,
	})
	manifest.docs.push({ id: walkDoc.id, name: walkDoc.title })
	const walkCharId = charIds.vincent
	const walkResId = resIds.monaLisa
	const walkBlocks: unknown[] = [
		{
			type: "paragraph",
			content: [{ type: "text", text: docs.walk.body.text }],
		},
	]
	if (walkCharId !== undefined) {
		walkBlocks.push({
			type: "paragraph",
			content: [
				{
					type: "charChip",
					props: {
						charId: walkCharId,
						fallbackName: chars.vincent.name.text,
					},
				},
			],
		})
	}
	if (walkResId !== undefined) {
		walkBlocks.push({
			type: "paragraph",
			content: [{ type: "resCard", props: { resId: walkResId } }],
		})
	}
	await rt.docs.patchDraft({
		id: walkDoc.id,
		title: docs.walk.title.text,
		content: { version: 4, blocks: walkBlocks },
		charIds: walkCharId === undefined ? [] : [walkCharId],
		resIds: walkResId === undefined ? [] : [walkResId],
	})
	await rt.docs.commitDraft({ id: walkDoc.id, message: "première note" })
	writeManifest(rt, manifest)

	log("seed: creating comments")
	const commentIds: (string | undefined)[] = []
	for (const def of comments) {
		const resId = def.resKey === undefined ? undefined : resIds[def.resKey]
		const charId = def.charKey === undefined ? undefined : charIds[def.charKey]
		if (def.resKey !== undefined && resId === undefined) {
			commentIds.push(undefined)
			continue
		}
		const parentId =
			def.replyTo === undefined ? undefined : commentIds[def.replyTo]
		if (def.replyTo !== undefined && parentId === undefined) {
			commentIds.push(undefined)
			continue
		}
		const created = await rt.comments.create({
			body: def.body.text,
			parentId,
			resIds: resId === undefined ? [] : [resId],
			charIds: charId === undefined ? [] : [charId],
		})
		commentIds.push(created.id)
		manifest.comments.push(created.id)
	}
	writeManifest(rt, manifest)

	log("seed: creating sync device")
	const device = await rt.sync.deviceCreate({
		name: syncDevice.name.text,
		notes: syncDevice.notes.text,
	})
	manifest.syncDevices.push(device.id)
	writeManifest(rt, manifest)

	log("seed: rebuilding resource metadata")
	await rt.res.drainMetaQueue()
	for (const row of manifest.resources) {
		const detail = await rt.res.detail(row.id)
		if (detail.contentPluginId !== GALLERY_PLUGIN_ID) continue
		if (
			detail.sourceMeta != null &&
			populatedCover(detail.coverMeta) !== undefined
		) {
			continue
		}
		log(`seed: retrying metadata for ${row.name}`)
		await rt.res.rebuildAllMeta(row.id)
	}

	manifest.status = "complete"
	writeManifest(rt, manifest)
	log(`seed: done (${manifest.resources.length} resources)`)
	log("seed: admin password is demo")
	return [...createdFacets]
}

export function missingFacets(
	created: readonly GalleryFacet[],
): readonly GalleryFacet[] {
	const have = new Set(created)
	return catalogFacets().filter((facet) => !have.has(facet))
}
