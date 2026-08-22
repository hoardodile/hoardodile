export type FileEntry = {
	readonly filename: string
	readonly sizeBytes?: number
	readonly ext?: string
}

export type FileSourceMeta = {
	readonly fileCount?: number
}

export interface FileSchema {
	readonly file: FileEntry
	readonly sourceMeta: FileSourceMeta
}
