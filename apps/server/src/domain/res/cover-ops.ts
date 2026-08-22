import type { ResFiles } from "./files.ts"
import type { ResRepository } from "./repo.ts"

export type ResCoverOpsDeps = {
	readonly repo: ResRepository
	readonly files: ResFiles
}

export type ResCoverOps = {
	hasCoverMeta(id: string): Promise<boolean>
	findCover(id: string): Promise<string | undefined>
}

export function buildResourceCoverOps(deps: ResCoverOpsDeps): ResCoverOps {
	const { repo, files } = deps

	async function hasCoverMeta(id: string): Promise<boolean> {
		const row = repo.findById(id)
		return row.coverMeta !== null
	}

	async function findCover(id: string): Promise<string | undefined> {
		const row = repo.findById(id)
		return files.findCover(id, row.coverVersion)
	}

	return {
		hasCoverMeta,
		findCover,
	}
}
