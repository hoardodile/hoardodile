import { mountWorkbench } from "./workbench.ts"

void mountWorkbench().catch((err: unknown) => {
	console.error("[workbench] failed to start:", err)
	const stage = document.querySelector("#stage")
	if (stage !== null) {
		const pre = document.createElement("pre")
		pre.textContent =
			err instanceof Error ? (err.stack ?? err.message) : String(err)
		stage.appendChild(pre)
	}
})
