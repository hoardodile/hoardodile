// Fixture plugin: detect returns its classification spread on ok(), and
// later hooks read it back via api.context.detect — the one-pass
// classification flow.
export default {
	async detect(api) {
		const files = await api.listFileNames()
		return { ok: true, files, archive: files.length === 1 }
	},
	async sourceMeta(api) {
		const shape = api.context.detect
		return shape === undefined
			? { fromContext: false }
			: {
					fromContext: true,
					files: shape.files,
					archive: shape.archive,
				}
	},
}
