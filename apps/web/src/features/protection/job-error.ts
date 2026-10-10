export function jobErrorKey(error: { code: string; message: string }) {
	if (error.code === "low_disk") return "protectionUx.errorSpace" as const
	if (error.code === "incomplete_backup")
		return "protectionUx.errorIncomplete" as const
	return "protectionUx.taskFailed" as const
}
