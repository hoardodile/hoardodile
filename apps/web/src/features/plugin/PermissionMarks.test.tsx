import type { PluginManifest, PluginPermissions } from "@hoardodile/sdk-types"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PermissionMarks } from "./PluginSettingsPanel"

const ALL_GRANTED: PluginPermissions = {
	sourceMeta: true,
	searchMeta: true,
	danmaku: true,
	message: true,
	imageHashes: true,
	container: true,
}

function manifestWith(permissions: PluginPermissions): PluginManifest {
	return {
		id: "665cfbdd-1db6-48f5-9d53-1008b8cb84c3",
		name: "Test",
		description: "Test",
		version: "1.0.0",
		permissions,
	}
}

function renderMarks(
	permissions: PluginPermissions,
): ReturnType<typeof render> {
	return render(
		<PermissionMarks
			p={{
				manifest: manifestWith(permissions),
				id: manifestWith(permissions).id,
			}}
		/>,
	)
}

describe("PermissionMarks", () => {
	it("folds grants beyond three into a +N chip", () => {
		renderMarks(ALL_GRANTED)
		expect(screen.getByText("+3")).toBeInTheDocument()
		// The first three grants keep their per-icon tooltips; the folded
		// three enumerate in the chip's tooltip.
		expect(screen.getByTitle("Source metadata")).toBeInTheDocument()
		expect(screen.getByTitle("Search metadata")).toBeInTheDocument()
		expect(screen.getByTitle("Danmaku")).toBeInTheDocument()
		expect(
			screen.getByTitle("Messages, Image hashes, Containers"),
		).toBeInTheDocument()
	})

	it("folds five grants into a +2 chip", () => {
		renderMarks({
			...ALL_GRANTED,
			container: false,
		})
		expect(screen.getByText("+2")).toBeInTheDocument()
		expect(screen.getByTitle("Messages, Image hashes")).toBeInTheDocument()
	})

	it("folds four grants into a +1 chip", () => {
		renderMarks({
			...ALL_GRANTED,
			danmaku: false,
			container: false,
		})
		expect(screen.getByText("+1")).toBeInTheDocument()
		expect(screen.getByTitle("Image hashes")).toBeInTheDocument()
	})

	it("renders every mark without a chip when three or fewer are granted", () => {
		renderMarks({
			...ALL_GRANTED,
			danmaku: false,
			message: false,
			container: false,
		})
		expect(screen.queryByText(/^\+\d$/)).not.toBeInTheDocument()
		expect(screen.getByTitle("Source metadata")).toBeInTheDocument()
		expect(screen.getByTitle("Search metadata")).toBeInTheDocument()
		expect(screen.getByTitle("Image hashes")).toBeInTheDocument()
	})

	it("renders nothing when no permission is granted", () => {
		const { container } = renderMarks({
			sourceMeta: false,
			searchMeta: false,
			danmaku: false,
			message: false,
			imageHashes: false,
			container: false,
		})
		expect(container).toBeEmptyDOMElement()
	})
})
