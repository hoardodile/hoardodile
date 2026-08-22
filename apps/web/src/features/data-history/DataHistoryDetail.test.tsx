import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import type { DataHistoryList } from "./api"
import { DataHistoryDetail } from "./DataHistoryDetail"

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

function createQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
}

function renderWithClient(element: React.ReactElement) {
	return render(
		<QueryClientProvider client={createQueryClient()}>
			{element}
		</QueryClientProvider>,
	)
}

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

describe("DataHistoryDetail", () => {
	test("current archive has editable name and note", () => {
		const data = buildData()
		renderWithClient(
			<DataHistoryDetail
				data={data}
				selectedId="archive-2"
				onRestore={vi.fn()}
				onDeleteBackup={vi.fn()}
				onSwitchVersion={vi.fn()}
				isRestoring={false}
				isDeleting={false}
				isSwitching={false}
			/>,
		)

		expect(screen.getByTestId("name-preview")).not.toBeDisabled()
		expect(screen.getByTestId("note-preview")).not.toBeDisabled()
	})

	test("non-current archive shows plain name and note text", () => {
		const data = buildData()
		renderWithClient(
			<DataHistoryDetail
				data={data}
				selectedId="archive-1"
				onRestore={vi.fn()}
				onDeleteBackup={vi.fn()}
				onSwitchVersion={vi.fn()}
				isRestoring={false}
				isDeleting={false}
				isSwitching={false}
			/>,
		)

		expect(screen.queryByTestId("name-preview")).not.toBeInTheDocument()
		expect(screen.queryByTestId("note-preview")).not.toBeInTheDocument()
		expect(screen.getByText("v1 release")).toBeInTheDocument()
		// The header is the only name surface on read-only archives.
		expect(
			screen.getAllByText('dataHistory.archive.title({"version":1})'),
		).toHaveLength(1)
	})

	test("archived backup shows plain name and note text", () => {
		const data = buildData()
		renderWithClient(
			<DataHistoryDetail
				data={data}
				selectedId="backup-app-1.sqlite"
				onRestore={vi.fn()}
				onDeleteBackup={vi.fn()}
				onSwitchVersion={vi.fn()}
				isRestoring={false}
				isDeleting={false}
				isSwitching={false}
			/>,
		)

		expect(screen.queryByTestId("name-preview")).not.toBeInTheDocument()
		expect(screen.queryByTestId("note-preview")).not.toBeInTheDocument()
		// The header is the only name surface on archived backups.
		expect(screen.getAllByText("migration backup")).toHaveLength(1)
		expect(screen.getByText("before migration")).toBeInTheDocument()
	})

	test("shows the recorded contents summary when counts exist", () => {
		const data = buildData()
		const group = data.groups[1]
		if (group === undefined) throw new Error("missing group")
		data.groups[1] = {
			...group,
			backups: [
				{
					kind: "backup",
					id: "backup-app-2.sqlite",
					fileName: "app-2.sqlite",
					auto: false,
					size: 256,
					createdAt: 1_700_000_000_000,
					activeVersionAtCreate: 2,
					counts: { resources: 1248, characters: 36, documents: 5 },
				},
			],
		}
		renderWithClient(
			<DataHistoryDetail
				data={data}
				selectedId="backup-app-2.sqlite"
				onRestore={vi.fn()}
				onDeleteBackup={vi.fn()}
				onSwitchVersion={vi.fn()}
				isRestoring={false}
				isDeleting={false}
				isSwitching={false}
			/>,
		)

		expect(screen.getByText("dataHistory.detail.contents")).toBeInTheDocument()
		expect(
			screen.getByText(
				'dataHistory.detail.contentsValue({"resources":1248,"characters":36,"documents":5})',
			),
		).toBeInTheDocument()
	})

	test("auto snapshot shows no editable name/note and its own hints", () => {
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
					activeVersionAtCreate: 2,
				},
			],
		}
		renderWithClient(
			<DataHistoryDetail
				data={data}
				selectedId="backup-auto-1.sqlite"
				onRestore={vi.fn()}
				onDeleteBackup={vi.fn()}
				onSwitchVersion={vi.fn()}
				isRestoring={false}
				isDeleting={false}
				isSwitching={false}
			/>,
		)

		expect(
			screen.getByText('dataHistory.detail.backupOnVersion({"version":2})'),
		).toBeInTheDocument()
		expect(screen.queryByTestId("name-preview")).not.toBeInTheDocument()
		expect(screen.queryByTestId("note-preview")).not.toBeInTheDocument()
		// Auto snapshots stay restorable and deletable.
		expect(screen.getByTestId("restore-auto-1.sqlite")).toBeInTheDocument()
		expect(screen.getByTestId("delete-auto-1.sqlite")).toBeInTheDocument()
		expect(
			screen.getByText("dataHistory.backup.restoreHint"),
		).toBeInTheDocument()
	})
})
