import "./style.css"
import { createPluginRoot, definePluginAPI } from "@hoardodile/sdk-react"
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import { useState } from "react"

function Plugin() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Plugin dialog
			</button>
			<output data-testid="plugin-open">{String(open)}</output>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogTitle>Plugin overlay</DialogTitle>
					<button type="button" onClick={() => setOpen(false)}>
						Close plugin
					</button>
				</DialogContent>
			</Dialog>
		</>
	)
}
const { PluginAPIProvider } = definePluginAPI()
createPluginRoot({ provider: PluginAPIProvider, render: Plugin })
