import type { BackDriver, BackLocation } from "../lib/mobile-back-controller"

/** Physical entries and asynchronous traversal; replace NEVER trims forward. */
export function createBackHistory(
	initial: BackLocation[] = [
		{ href: "/before", state: null },
		{ href: "/page?x=1#part", state: { key: "page" } },
	],
) {
	const entries = structuredClone(initial)
	let index = entries.length - 1
	const listeners = new Set<() => void>()
	const tasks: (() => void)[] = []
	const moves: number[] = []
	let writeError = false
	const driver: BackDriver = {
		read() {
			return structuredClone(entries[index]!)
		},
		push(location) {
			if (writeError) throw new DOMException("denied", "SecurityError")
			entries.splice(index + 1, entries.length, structuredClone(location))
			index++
		},
		replace(location) {
			if (writeError) throw new DOMException("denied", "SecurityError")
			entries[index] = structuredClone(location)
		},
		go(delta) {
			moves.push(delta)
			tasks.push(() => {
				const next = index + delta
				if (next < 0 || next >= entries.length || next === index) return
				index = next
				for (const listener of listeners) listener()
			})
		},
		listen(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
	return {
		driver,
		entries,
		moves,
		schedule(task: () => void) {
			tasks.push(task)
		},
		async tick() {
			tasks.shift()?.()
			await Promise.resolve()
		},
		async settle() {
			for (let i = 0; tasks.length > 0; i++) {
				if (i > 100) throw new Error("History failed to settle")
				tasks.shift()?.()
				await Promise.resolve()
			}
		},
		emit() {
			for (const listener of listeners) listener()
		},
		failWrites(value: boolean) {
			writeError = value
		},
		get index() {
			return index
		},
		get listeners() {
			return listeners.size
		},
	}
}
