/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	initialPrecacheState,
	type PrecacheResult,
	precacheReducer,
} from "./use-precache"

const RESULT: PrecacheResult = {
	resources: {
		total: 3,
		succeeded: 3,
		failed: 0,
		errors: [],
		thumbUrls: ["/a.jpg", "/b.jpg"],
	},
	characters: {
		total: 1,
		succeeded: 0,
		failed: 1,
		errors: [{ id: "c1", error: "boom" }],
		thumbUrls: ["/c.jpg"],
	},
}

describe("precacheReducer", () => {
	it("starts in checking state", () => {
		expect(initialPrecacheState.status).toBe("checking")
	})

	it("start resets everything and enters streaming", () => {
		const dirty = precacheReducer(initialPrecacheState, {
			type: "error",
			error: "old",
		})
		const state = precacheReducer(dirty, { type: "start" })
		expect(state).toEqual({ ...initialPrecacheState, status: "streaming" })
	})

	it("phase resets current progress, progress advances it", () => {
		let state = precacheReducer(initialPrecacheState, { type: "start" })
		state = precacheReducer(state, {
			type: "phase",
			phase: "resources",
			total: 10,
		})
		expect(state.progress).toEqual({
			phase: "resources",
			current: 0,
			total: 10,
		})
		state = precacheReducer(state, {
			type: "progress",
			phase: "resources",
			current: 4,
			total: 10,
		})
		expect(state.progress).toEqual({
			phase: "resources",
			current: 4,
			total: 10,
		})
	})

	it("done stores the result and enters done", () => {
		let state = precacheReducer(initialPrecacheState, { type: "start" })
		state = precacheReducer(state, { type: "done", result: RESULT })
		expect(state.status).toBe("done")
		expect(state.result).toBe(RESULT)
	})

	it("warming tracks its own progress and returns to done", () => {
		let state = precacheReducer(initialPrecacheState, { type: "start" })
		state = precacheReducer(state, { type: "done", result: RESULT })
		state = precacheReducer(state, { type: "warm-start", total: 3 })
		expect(state.status).toBe("warming")
		expect(state.warming).toEqual({ done: 0, total: 3 })
		state = precacheReducer(state, { type: "warm-progress", done: 2 })
		expect(state.warming).toEqual({ done: 2, total: 3 })
		state = precacheReducer(state, { type: "warm-done" })
		expect(state.status).toBe("done")
		expect(state.result).toBe(RESULT)
	})

	it("aborted resets progress and enters aborted", () => {
		let state = precacheReducer(initialPrecacheState, { type: "start" })
		state = precacheReducer(state, {
			type: "progress",
			phase: "resources",
			current: 4,
			total: 10,
		})
		state = precacheReducer(state, { type: "aborted" })
		expect(state.status).toBe("aborted")
		expect(state.progress).toEqual({ phase: null, current: 0, total: 0 })
	})

	it("conflict enters error state with the conflict flag", () => {
		let state = precacheReducer(initialPrecacheState, { type: "start" })
		state = precacheReducer(state, { type: "conflict" })
		expect(state.status).toBe("error")
		expect(state.conflict).toBe(true)
	})

	it("stream-lost errors mid-stream but preserves a finished run", () => {
		let state = precacheReducer(initialPrecacheState, { type: "start" })
		state = precacheReducer(state, { type: "stream-lost" })
		expect(state.status).toBe("error")
		expect(state.error).toBe("Stream disconnected")

		let finished = precacheReducer(initialPrecacheState, { type: "start" })
		finished = precacheReducer(finished, { type: "done", result: RESULT })
		finished = precacheReducer(finished, { type: "stream-lost" })
		expect(finished.status).toBe("done")
		expect(finished.result).toBe(RESULT)
	})

	it("resume stays in checking, resume-failed falls back to idle", () => {
		const resumed = precacheReducer(initialPrecacheState, { type: "resume" })
		expect(resumed.status).toBe("checking")
		const failed = precacheReducer(resumed, { type: "resume-failed" })
		expect(failed.status).toBe("idle")
	})

	it("a resumed run enters streaming on the first real event", () => {
		let state = precacheReducer(initialPrecacheState, { type: "resume" })
		state = precacheReducer(state, {
			type: "phase",
			phase: "resources",
			total: 10,
		})
		expect(state.status).toBe("streaming")
	})

	it("server-idle enters idle", () => {
		let state = precacheReducer(initialPrecacheState, { type: "resume" })
		state = precacheReducer(state, { type: "server-idle" })
		expect(state.status).toBe("idle")
	})
})
