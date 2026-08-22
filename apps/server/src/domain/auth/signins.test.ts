import { openDb } from "src/infra/db/connection.ts"
import { describe, expect, test } from "vitest"
import { listSignIns, recordSignIn } from "./signins.ts"

function openLog(): ReturnType<typeof openDb> {
	const db = openDb(":memory:")
	db.runMigrations()
	return db
}

describe("sign-ins log", () => {
	test("stores the newest sign-ins first and prunes old rows on write", () => {
		const db = openLog()
		const old = Date.now() - 91 * 24 * 60 * 60 * 1000
		recordSignIn(db.db, {
			id: "session-old",
			ip: "10.0.0.9",
			origin: "lan",
			deviceLabel: "Chrome on Windows",
			recordedAt: old,
		})
		recordSignIn(db.db, {
			id: "session-1",
			ip: "192.168.1.50",
			origin: "lan",
			deviceLabel: "Chrome on Windows",
			recordedAt: Date.now(),
		})
		recordSignIn(db.db, {
			id: "session-2",
			ip: "127.0.0.1",
			origin: "loopback",
			deviceLabel: "Electron desktop",
			recordedAt: Date.now() + 1,
		})
		const rows = listSignIns(db.db)
		expect(rows.map((row) => row.id)).toEqual(["session-2", "session-1"])
		expect(rows[1]?.origin).toBe("lan")
		db.close()
	})

	test("prunes nothing inside the retention window", () => {
		const db = openLog()
		recordSignIn(db.db, {
			id: "session-recent",
			ip: "192.168.1.50",
			origin: "lan",
			deviceLabel: "Chrome on Windows",
			recordedAt: Date.now() - 89 * 24 * 60 * 60 * 1000,
		})
		recordSignIn(db.db, {
			id: "session-new",
			ip: "127.0.0.1",
			origin: "loopback",
			deviceLabel: "Electron desktop",
			recordedAt: Date.now(),
		})
		expect(listSignIns(db.db)).toHaveLength(2)
		db.close()
	})

	test("respects the result limit", () => {
		const db = openLog()
		for (let i = 0; i < 25; i++) {
			recordSignIn(db.db, {
				id: `session-${i}`,
				ip: `192.168.1.${i}`,
				origin: "lan",
				deviceLabel: "Chrome on Windows",
				recordedAt: Date.now() + i,
			})
		}
		expect(listSignIns(db.db)).toHaveLength(20)
		db.close()
	})
})
