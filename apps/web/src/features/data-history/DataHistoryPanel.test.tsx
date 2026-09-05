import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { DataHistoryPanel } from "./DataHistoryPanel"

type AutoStatus = { enabled: boolean; keep: number; lastAt: number | null }

const { statusRef } = vi.hoisted(() => ({
	statusRef: { value: undefined as AutoStatus | undefined },
}))

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

vi.mock("./api", () => ({
	dataHistoryListQueryOptions: () => ({
		queryKey: ["data-history", "list"],
		queryFn: async () => ({
			groups: [],
			currentVersion: 1,
			activeVersion: 1,
		}),
	}),
	autoStatusQueryOptions: () => ({
		queryKey: ["data-history", "auto-status"],
		queryFn: async () => statusRef.value,
	}),
	createBackupMutation: () => ({ mutationFn: async () => undefined }),
	createVersionMutation: () => ({ mutationFn: async () => undefined }),
	deleteBackupMutation: () => ({ mutationFn: async () => undefined }),
	restoreBackupMutation: () => ({ mutationFn: async () => undefined }),
	switchVersionMutation: () => ({ mutationFn: async () => undefined }),
	invalidateDataHistory: async () => undefined,
}))

function renderPanel() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={client}>
			<DataHistoryPanel />
		</QueryClientProvider>,
	)
}

describe("DataHistoryPanel archive and legacy boundaries", () => {
	test("keeps archive creation available without advertising legacy snapshots as complete backups", async () => {
		statusRef.value = { enabled: true, keep: 3, lastAt: 1_700_000_000_000 }
		renderPanel()

		expect(await screen.findByTestId("create-archive")).toBeInTheDocument()
		expect(screen.queryByTestId("auto-status")).not.toBeInTheDocument()
		expect(screen.queryByTestId("create-backup")).not.toBeInTheDocument()
	})
})
