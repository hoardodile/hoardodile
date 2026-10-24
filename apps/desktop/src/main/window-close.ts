import type { CloseAction } from "./config.ts"

/** Cancel is resolved before dropping the credential or destroying a window. */
export async function closeWindowWithProtection(options: {
	readonly action: CloseAction
	readonly confirm: () => Promise<"tray" | "quit" | "cancel">
	readonly lock: () => Promise<void>
	readonly hide: () => void
	readonly quit: () => Promise<void>
}): Promise<void> {
	const action =
		options.action === "ask" ? await options.confirm() : options.action
	if (action === "cancel") return
	await options.lock()
	if (action === "tray") options.hide()
	else await options.quit()
}
