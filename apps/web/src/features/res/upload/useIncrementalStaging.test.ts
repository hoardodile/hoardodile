import { act, renderHook } from "@testing-library/react"
import { vi } from "vitest"
import { randomUUID } from "@/lib/randomUUID"
import type { FileListEntry } from "./FileListEditor"
import { STAGING_MAX_INFLIGHT, stageSingleFile } from "./upload"
import { useIncrementalStaging } from "./useIncrementalStaging"

vi.mock("./upload", async (importOriginal) => ({
	...(await importOriginal<typeof import("./upload")>()),
	stageSingleFile: vi.fn(),
}))

const mockedStageSingleFile = vi.mocked(stageSingleFile)

function makeFile(name: string): File {
	return new File(["x"], name, { type: "image/png" })
}

function makeEntry(name: string): FileListEntry {
	return { id: randomUUID(), file: makeFile(name) }
}

function flushPromises(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("useIncrementalStaging", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		mockedStageSingleFile.mockReset()
		mockedStageSingleFile.mockImplementation(async () => ({
			fileId: randomUUID(),
		}))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("stages each file independently and exposes aligned fileIds", async () => {
		const a = makeEntry("a.png")
		const b = makeEntry("b.png")
		const { result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a, b] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		expect(mockedStageSingleFile).toHaveBeenCalledTimes(2)
		expect(result.current.stagingComplete).toBe(true)
		expect(result.current.fileIds).toHaveLength(2)
		expect(result.current.fileIds[0]).toBeDefined()
		expect(result.current.fileIds[1]).toBeDefined()
	})

	test("appending a file stages only the new file", async () => {
		const a = makeEntry("a.png")
		const b = makeEntry("b.png")
		const { rerender, result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a, b] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})
		expect(mockedStageSingleFile).toHaveBeenCalledTimes(2)

		const c = makeEntry("c.png")
		rerender({ entries: [a, b, c] })

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		// Only the appended file is staged.
		expect(mockedStageSingleFile).toHaveBeenCalledTimes(3)
		expect(result.current.fileIds).toHaveLength(3)
		// The first two fileIds are preserved (not re-uploaded).
		expect(result.current.fileIds[0]).toBeDefined()
		expect(result.current.fileIds[1]).toBeDefined()
		expect(result.current.fileIds[2]).toBeDefined()
	})

	test("removing a file drops its local fileId and never re-uploads", async () => {
		const a = makeEntry("a.png")
		const b = makeEntry("b.png")
		const { rerender, result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a, b] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})
		expect(mockedStageSingleFile).toHaveBeenCalledTimes(2)

		rerender({ entries: [a] })

		await act(async () => {
			await flushPromises()
		})

		// No new upload happened.
		expect(mockedStageSingleFile).toHaveBeenCalledTimes(2)
		// The removed file's staged fileId is no longer exposed locally.
		expect(result.current.fileIds).toHaveLength(1)
		expect(result.current.fileIds[0]).toBeDefined()
	})

	test("removing a file mid-upload does not abort or surface an error", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const a = makeEntry("a.png")
		const b = makeEntry("b.png")

		let resolveB: (value: { fileId: string }) => void = () => {}
		mockedStageSingleFile.mockImplementation(async (opts) => {
			if (opts.file.name === "b.png") {
				return new Promise<{ fileId: string }>((resolve) => {
					resolveB = resolve
				})
			}
			return { fileId: randomUUID() }
		})

		const { rerender, result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a, b] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		// Remove b while its upload is still pending.
		rerender({ entries: [a] })

		await act(async () => {
			await flushPromises()
		})

		expect(result.current.fileIds).toHaveLength(1)
		expect(result.current.fileIds[0]).toBeDefined()
		expect(result.current.isStaging).toBe(false)
		expect(result.current.stagingComplete).toBe(true)
		expect(consoleSpy).not.toHaveBeenCalled()

		// Even after the removed upload finally resolves, nothing changes.
		act(() => {
			resolveB({ fileId: randomUUID() })
		})
		await act(async () => {
			await flushPromises()
		})

		expect(result.current.fileIds).toHaveLength(1)
		expect(consoleSpy).not.toHaveBeenCalled()

		consoleSpy.mockRestore()
	})

	test("a failed upload settles staging and marks the slot as failed", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const a = makeEntry("a.png")
		mockedStageSingleFile.mockRejectedValue(new Error("network error"))

		const { result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		// Failure is a settled state, not "in progress": the gate unlocks.
		expect(result.current.isStaging).toBe(false)
		expect(result.current.stagingComplete).toBe(false)
		expect(result.current.fileIds[0]).toBeUndefined()
		// -1 marks the failed entry so the tile stops showing a progress bar.
		expect(result.current.fileProgresses[0]).toBe(-1)

		consoleSpy.mockRestore()
	})

	test("staging stays in progress until the last in-flight upload settles", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const a = makeEntry("a.png")
		const b = makeEntry("b.png")

		let resolveB: (value: { fileId: string }) => void = () => {}
		mockedStageSingleFile.mockImplementation(async (opts) => {
			if (opts.file.name === "a.png") {
				throw new Error("network error")
			}
			return new Promise<{ fileId: string }>((resolve) => {
				resolveB = resolve
			})
		})

		const { result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a, b] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		// a failed, but b is still uploading — the gate must stay locked.
		expect(result.current.isStaging).toBe(true)
		expect(result.current.fileProgresses[0]).toBe(-1)

		act(() => {
			resolveB({ fileId: randomUUID() })
		})
		await act(async () => {
			await flushPromises()
		})

		// With nothing left in flight the gate unlocks; b is staged, a failed.
		expect(result.current.isStaging).toBe(false)
		expect(result.current.stagingComplete).toBe(false)
		expect(result.current.fileIds[1]).toBeDefined()
		expect(result.current.fileProgresses[0]).toBe(-1)

		consoleSpy.mockRestore()
	})

	test("removing a failed file lets the rest complete staging", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const a = makeEntry("a.png")
		const b = makeEntry("b.png")
		mockedStageSingleFile.mockImplementation(async (opts) => {
			if (opts.file.name === "a.png") {
				throw new Error("network error")
			}
			return { fileId: randomUUID() }
		})

		const { rerender, result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a, b] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		expect(result.current.isStaging).toBe(false)
		expect(result.current.stagingComplete).toBe(false)

		// Drop the failed file; the remaining entry is fully staged.
		rerender({ entries: [b] })

		await act(async () => {
			await flushPromises()
		})

		expect(result.current.isStaging).toBe(false)
		expect(result.current.stagingComplete).toBe(true)
		expect(result.current.fileIds).toHaveLength(1)
		expect(result.current.fileIds[0]).toBeDefined()

		consoleSpy.mockRestore()
	})

	test("stages at most STAGING_MAX_INFLIGHT files concurrently", async () => {
		const entries = Array.from({ length: 8 }, (_, i) => makeEntry(`${i}.png`))
		const pending = new Map<string, (value: { fileId: string }) => void>()
		let inFlight = 0
		let maxInFlight = 0
		mockedStageSingleFile.mockImplementation(async (opts) => {
			inFlight++
			maxInFlight = Math.max(maxInFlight, inFlight)
			return new Promise<{ fileId: string }>((resolve) => {
				pending.set(opts.file.name, resolve)
			}).finally(() => {
				inFlight--
			})
		})

		const { result } = renderHook(
			({ entries: list }) => useIncrementalStaging(list, { debounceMs: 100 }),
			{ initialProps: { entries: entries as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		// Only the first slot worth of files launched; the rest wait.
		expect(maxInFlight).toBeLessThanOrEqual(STAGING_MAX_INFLIGHT)
		expect(inFlight).toBe(STAGING_MAX_INFLIGHT)

		// Resolving the first file exposes its fileId immediately, while the
		// rest of the batch is still uploading, and frees a slot for the next.
		act(() => {
			pending.get("0.png")?.({ fileId: randomUUID() })
		})
		await act(async () => {
			await flushPromises()
		})
		expect(result.current.fileIds[0]).toBeDefined()
		expect(result.current.fileIds[1]).toBeUndefined()
		expect(inFlight).toBe(STAGING_MAX_INFLIGHT)

		// Resolve the rest in waves — every freed slot launches the next
		// file, so drain until nothing is left.
		for (let guard = 0; guard < entries.length && inFlight > 0; guard++) {
			act(() => {
				for (const resolve of pending.values()) {
					resolve({ fileId: randomUUID() })
				}
			})
			await act(async () => {
				await flushPromises()
			})
		}
		expect(inFlight).toBe(0)
		expect(maxInFlight).toBeLessThanOrEqual(STAGING_MAX_INFLIGHT)
		expect(result.current.isStaging).toBe(false)
		expect(result.current.stagingComplete).toBe(true)
		expect(result.current.fileIds.every((id) => typeof id === "string")).toBe(
			true,
		)
	})

	test("appending a file mid-upload keeps in-flight results", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const a = makeEntry("a.png")
		const b = makeEntry("b.png")
		let resolveB: (value: { fileId: string }) => void = () => {}
		mockedStageSingleFile.mockImplementation(async (opts) => {
			if (opts.file.name === "b.png") {
				return new Promise<{ fileId: string }>((resolve) => {
					resolveB = resolve
				})
			}
			return { fileId: randomUUID() }
		})

		const { rerender, result } = renderHook(
			({ entries }) => useIncrementalStaging(entries, { debounceMs: 100 }),
			{ initialProps: { entries: [a, b] as FileListEntry[] } },
		)

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})

		// Append c while b is still uploading.
		const c = makeEntry("c.png")
		rerender({ entries: [a, b, c] })

		await act(async () => {
			vi.advanceTimersByTime(150)
			await flushPromises()
		})
		expect(mockedStageSingleFile).toHaveBeenCalledTimes(3)

		// b's late resolution must still be adopted — adding a file must not
		// invalidate the uploads already in flight.
		act(() => {
			resolveB({ fileId: randomUUID() })
		})
		await act(async () => {
			await flushPromises()
		})

		expect(result.current.fileIds).toHaveLength(3)
		expect(result.current.fileIds[1]).toBeDefined()
		expect(result.current.isStaging).toBe(false)
		expect(result.current.stagingComplete).toBe(true)
		expect(consoleSpy).not.toHaveBeenCalled()

		consoleSpy.mockRestore()
	})
})
