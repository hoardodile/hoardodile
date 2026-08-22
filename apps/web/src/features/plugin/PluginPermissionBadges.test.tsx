import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
	grantedPermissionKeys,
	PluginPermissionBadges,
} from "./PluginPermissionBadges"

describe("grantedPermissionKeys", () => {
	it("returns only granted permissions in stable order", () => {
		expect(
			grantedPermissionKeys({
				sourceMeta: true,
				searchMeta: false,
				danmaku: true,
				message: false,
				imageHashes: false,
			}),
		).toEqual(["sourceMeta", "danmaku"])
	})

	it("returns empty when nothing is granted", () => {
		expect(
			grantedPermissionKeys({
				sourceMeta: false,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
			}),
		).toEqual([])
	})
})

describe("PluginPermissionBadges", () => {
	it("renders a badge for each granted permission only", () => {
		render(
			<PluginPermissionBadges
				permissions={{
					sourceMeta: true,
					searchMeta: false,
					danmaku: false,
					message: true,
					imageHashes: false,
				}}
			/>,
		)

		expect(screen.getByText("Source metadata")).toBeInTheDocument()
		expect(screen.getByText("Messages")).toBeInTheDocument()
		expect(screen.queryByText("Search metadata")).not.toBeInTheDocument()
		expect(screen.queryByText("Danmaku")).not.toBeInTheDocument()
	})

	it("renders nothing when no permission is granted", () => {
		const { container } = render(
			<PluginPermissionBadges
				permissions={{
					sourceMeta: false,
					searchMeta: false,
					danmaku: false,
					message: false,
					imageHashes: false,
				}}
			/>,
		)

		expect(container).toBeEmptyDOMElement()
	})
})
