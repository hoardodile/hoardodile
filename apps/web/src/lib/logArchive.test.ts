import { unzipSync } from "fflate"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pushClientLog } from "./clientLog"
import { downloadLogArchive } from "./logArchive"

const { trpcQueryMock } = vi.hoisted(() => ({ trpcQueryMock: vi.fn() }))

vi.mock("@/trpc/factory", () => ({ trpcQuery: trpcQueryMock }))

beforeEach(() => {
	trpcQueryMock.mockReset()
	trpcQueryMock.mockResolvedValue({
		files: [
			{ name: "app.2026-08-27.1.log", content: "server line\n" },
			{ name: "app.error.2026-08-27.1.log", content: "error line\n" },
		],
	})
	vi.stubGlobal("URL", {
		createObjectURL: vi.fn(() => "blob:fixture"),
		revokeObjectURL: vi.fn(),
	})
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("downloadLogArchive", () => {
	it("zips the frontend log and the server log files, then triggers the download", async () => {
		pushClientLog("error", "archive marker")
		await downloadLogArchive()

		expect(trpcQueryMock).toHaveBeenCalledWith("diagnostics", "logs")
		const createSpy = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>
		expect(createSpy).toHaveBeenCalledTimes(1)
		const blob = createSpy.mock.calls[0]![0] as Blob
		expect(blob.type).toBe("application/zip")
		expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)

		// The zip really contains both sides, real file names included.
		const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()))
		const names = Object.keys(archive)
		expect(names).toContain("frontend.log")
		expect(names).toContain("app.2026-08-27.1.log")
		expect(names).toContain("app.error.2026-08-27.1.log")
		const frontend = new TextDecoder().decode(archive["frontend.log"])
		expect(frontend).toContain("hoardodile v")
		expect(frontend).toContain("archive marker")
	})

	it("surfaces a failure to fetch the server logs", async () => {
		trpcQueryMock.mockRejectedValueOnce(new Error("server down"))
		await expect(downloadLogArchive()).rejects.toThrow("server down")
	})
})
