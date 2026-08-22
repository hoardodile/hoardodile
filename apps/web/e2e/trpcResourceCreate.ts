/**
 * Parses `resource.create` tRPC HTTP JSON (batch or single) for the new
 * resource id. Without a transformer the payload sits at `result.data`;
 * a transformer nests it one level deeper at `result.data.json`. Both
 * shapes are walked.
 */
export function resourceIdFromTrpcCreateJson(
	body: unknown,
): string | undefined {
	if (body === null || typeof body !== "object") return undefined
	if (Array.isArray(body)) {
		for (const item of body) {
			const id = resourceIdFromTrpcCreateJson(item)
			if (id !== undefined) return id
		}
		return undefined
	}
	const obj = body as Record<string, unknown>
	if (
		"result" in obj &&
		typeof obj.result === "object" &&
		obj.result !== null
	) {
		const r = obj.result as Record<string, unknown>
		if ("data" in r && typeof r.data === "object" && r.data !== null) {
			const d = r.data as Record<string, unknown>
			const payload =
				"json" in d && typeof d.json === "object" && d.json !== null
					? (d.json as Record<string, unknown>)
					: d
			const id = payload.id
			if (typeof id === "string" && id.length > 0) return id
		}
	}
	return undefined
}

export async function resourceIdFromTrpcCreateResponse(res: {
	json(): Promise<unknown>
}): Promise<string | undefined> {
	try {
		const body: unknown = await res.json()
		return resourceIdFromTrpcCreateJson(body)
	} catch {
		return undefined
	}
}
