import type { AppRouter } from "@hoardodile/server/router"
import { isTRPCClientError, type TRPCClientError } from "@trpc/client"
import type { TFunction } from "i18next"
import { errorMessage } from "@/lib/errors"

/**
 * The user-facing message for a tag-operation error: known server domain
 * errors (`data.domain.kind`) map to localized copy, everything else falls
 * back to the raw message or `common.unknownError`. Mirrors the
 * `*.has_dependencies` pattern from `DeleteEntityButton`.
 */
const TAG_ERROR_KEYS: Readonly<Record<string, string>> = {
	"tag.sibling_pair.cycle": "tags.errors.siblingCycle",
	"tag.sibling_pair.kind_isolation": "tags.errors.siblingKindIsolation",
	"tag.parent_rule.self": "tags.errors.parentSelf",
	"tag.parent_rule.cycle": "tags.errors.parentCycle",
	"tag.parent_rule.kind_isolation": "tags.errors.parentKindIsolation",
	"tag.rule.character_missing": "tags.errors.characterMissing",
	"tag.merge.kind_mismatch": "tags.errors.mergeKindMismatch",
	"tag.merge.creates_cycle": "tags.errors.mergeCreatesCycle",
	"tag.name_exists": "tags.errors.nameExists",
}

export function tagErrorMessage(err: unknown, t: TFunction): string {
	if (isTRPCClientError(err)) {
		const kind = readDomainKind((err as TRPCClientError<AppRouter>).data)
		if (kind !== undefined) {
			const key = TAG_ERROR_KEYS[kind]
			if (key !== undefined) return t(key)
		}
	}
	return errorMessage(err, t("common.unknownError"))
}

function readDomainKind(data: unknown): string | undefined {
	if (!isPlainObject(data)) return undefined
	const domain = data.domain
	if (!isPlainObject(domain) || typeof domain.kind !== "string")
		return undefined
	return domain.kind
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
