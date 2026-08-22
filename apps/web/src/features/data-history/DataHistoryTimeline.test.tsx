import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, test, vi } from "vitest"
import type { DataHistoryList } from "./api"
import { DataHistoryTimeline } from "./DataHistoryTimeline"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) => {
			if (params === undefined) return key
			return `${key}(${JSON.stringify(params)})`
		},
	}),
}))

vi.mock("@/features/settings/datePrefs", () => ({
	useDateFormatter: () => ({
		formatDateTime: (ts: number) => new Date(ts).toLocaleString(),
		formatDate: () => "",
		formatDateTrait: () => "",
	}),
}))

function buildData(): DataHistoryList {
	return {
		currentVersion: 2,
		activeVersion: 2,
		groups: [
			{
				archive: {
					kind: "archive",
					id: "archive-2",
					version: 2,
					dbSize: 1024,
					current: true,
					active: true,
				},
				backups: [],
			},
			{
				archive: {
					kind: "archive",
					id: "archive-1",
					version: 1,
					createdAt: 1_700_000_000_000,
					note: "v1 release",
					dbSize: 512,
					current: false,
					active: false,
				},
				backups: [
					{
						kind: "backup",
						id: "backup-app-1.sqlite",
						fileName: "app-1.sqlite",
						auto: false,
						name: "migration backup",
						note: "before migration",
						size: 256,
						createdAt: 1_700_000_000_000,
						activeVersionAtCreate: 1,
					},
				],
			},
		],
	}
}

describe("DataHistoryTimeline", () => {
	test("renders archive groups and backup nodes", () => {
		render(
			<DataHistoryTimeline
				data={buildData()}
				selectedId={undefined}
				onSelect={vi.fn()}
			/>,
		)

		expect(screen.getByTestId("archive-2")).toBeInTheDocument()
		expect(screen.getByTestId("archive-1")).toBeInTheDocument()
		expect(screen.getByTestId("backup-app-1.sqlite")).toBeInTheDocument()
		expect(screen.getByText("migration backup")).toBeInTheDocument()
		expect(screen.getByText("v2")).toBeInTheDocument()
		expect(screen.getByText("v1")).toBeInTheDocument()
	})

	test("calls onSelect when a node is clicked", async () => {
		const user = userEvent.setup()
		const onSelect = vi.fn()
		render(
			<DataHistoryTimeline
				data={buildData()}
				selectedId={undefined}
				onSelect={onSelect}
			/>,
		)

		await user.click(screen.getByTestId("backup-app-1.sqlite"))
		expect(onSelect).toHaveBeenCalledWith("backup-app-1.sqlite")
	})

	test("renders an auto badge for automatic snapshots", () => {
		const data = buildData()
		const group = data.groups[1]
		if (group === undefined) throw new Error("missing group")
		data.groups[1] = {
			...group,
			backups: [
				{
					kind: "backup",
					id: "backup-auto-1.sqlite",
					fileName: "auto-1.sqlite",
					auto: true,
					size: 256,
					createdAt: 1_700_000_000_000,
					activeVersionAtCreate: 1,
				},
			],
		}
		render(
			<DataHistoryTimeline
				data={data}
				selectedId={undefined}
				onSelect={vi.fn()}
			/>,
		)

		expect(screen.getByTestId("backup-auto-1.sqlite")).toBeInTheDocument()
		expect(screen.getByText("dataHistory.chip.auto")).toBeInTheDocument()
		// Only the auto node carries the badge (no duplicate across nodes).
		expect(screen.getAllByText("dataHistory.chip.auto")).toHaveLength(1)
	})

	test("shows empty state when no groups", () => {
		const empty: DataHistoryList = {
			currentVersion: 1,
			activeVersion: 1,
			groups: [],
		}
		render(
			<DataHistoryTimeline
				data={empty}
				selectedId={undefined}
				onSelect={vi.fn()}
			/>,
		)

		expect(screen.getByTestId("data-history-empty")).toBeInTheDocument()
	})
})
