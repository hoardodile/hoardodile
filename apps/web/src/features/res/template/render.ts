import type { CoverMeta, FileStats } from "@hoardodile/schemas"
import {
	type TemplateArg as Arg,
	type TemplateExpr as Expr,
	parseTemplateExpression,
	parseTemplateFragments,
} from "@hoardodile/sdk-types/template"
import { formatBytes } from "@/lib/formatBytes"
import { formatClockDuration } from "@/lib/formatDuration"
import { Icon, parseIconRef } from "./template-icons"

// The template grammar (fragment splitting, tokenising, parsing) lives
// in @hoardodile/sdk-types/template — shared verbatim with the CLI's
// build-time template lint so the two can never drift. This module only
// evaluates the AST. The parser is lenient: unparseable expressions
// render as the empty string.

// ── Evaluation context ───────────────────────────────────────────────────────

export type TemplateContext = {
	readonly locale: string
	readonly pluginId: string
	readonly manifest: {
		readonly i18n?: Record<string, string | Record<string, string>>
		readonly ui?: {
			readonly search?: {
				readonly kinds?: readonly {
					readonly key: string
					readonly icon?: string
				}[]
			}
		}
	}
	readonly iconClassName?: string
}

type EvalValue = string | React.ReactNode

type TemplateScope = {
	readonly file: FileStats | undefined
	readonly source: unknown
	readonly searchMeta?: unknown
	readonly data?: unknown
	readonly coverMeta?: CoverMeta
}

// ── Scope resolution (paths) ─────────────────────────────────────────────────

function resolvePath(
	segments: readonly string[],
	scope: TemplateScope,
): unknown {
	const [namespace, ...rest] = segments
	const root =
		namespace === "file"
			? scope.file
			: namespace === "searchMeta"
				? scope.searchMeta
				: namespace === "data"
					? scope.data
					: namespace === "coverMeta"
						? scope.coverMeta
						: scope.source
	if (root === undefined || root === null) return undefined
	let current: unknown = root
	for (const key of rest) {
		if (typeof current !== "object" || current === null) return undefined
		current = (current as Record<string, unknown>)[key]
	}
	return current
}

// ── Locale resolution ────────────────────────────────────────────────────────

/**
 * Resolve a locale-aware template value: if the value is a plain string,
 * return it directly; if it is a `Record<locale, string>`, pick the best
 * match for the current language. Falls back to the first available key
 * when nothing matches.
 */
export function resolveLocaleString(
	value: string | Record<string, string>,
	locale: string,
): string {
	if (typeof value === "string") return value
	const exact = value[locale]
	if (exact !== undefined) return exact
	const base = locale.split("-")[0] ?? locale
	const partial = value[base]
	if (partial !== undefined) return partial
	const first = Object.values(value)[0]
	return first ?? ""
}

// ── Expression evaluation ────────────────────────────────────────────────────

function evaluateExpression(
	expr: Expr,
	scope: TemplateScope,
	ctx: TemplateContext,
): EvalValue {
	if (expr.kind === "path") {
		const value = resolvePath(expr.segments, scope)
		if (value === undefined || value === null) return ""
		return String(value)
	}
	return evaluateCall(expr.name, expr.args, scope, ctx)
}

function evaluateCall(
	name: string,
	args: readonly Arg[],
	scope: TemplateScope,
	ctx: TemplateContext,
): EvalValue {
	switch (name) {
		case "bytes":
			return callPipe(args, scope, ctx, pipeBytes)
		case "duration":
			return callPipe(args, scope, ctx, pipeDuration)
		case "number":
			return callPipe(args, scope, ctx, pipeNumber)
		case "inc":
			return callPipe(args, scope, ctx, pipeInc)
		case "eq":
			return compareCall(args, scope, ctx, (a, b) => a === b)
		case "ne":
			return compareCall(args, scope, ctx, (a, b) => a !== b)
		case "gt":
			return compareCall(args, scope, ctx, (a, b) => {
				if (typeof a !== "number" || typeof b !== "number") return false
				return a > b
			})
		case "lt":
			return compareCall(args, scope, ctx, (a, b) => {
				if (typeof a !== "number" || typeof b !== "number") return false
				return a < b
			})
		case "gte":
			return compareCall(args, scope, ctx, (a, b) => {
				if (typeof a !== "number" || typeof b !== "number") return false
				return a >= b
			})
		case "lte":
			return compareCall(args, scope, ctx, (a, b) => {
				if (typeof a !== "number" || typeof b !== "number") return false
				return a <= b
			})
		case "if":
			return callIf(args, scope, ctx)
		case "t":
			return callT(args, ctx)
		case "icon":
			return callIcon(args, ctx)
		case "asset":
			return callAsset(args, ctx)
		case "kind":
			return callKind(args, scope, ctx)
		case "searchKindIcons":
			return callSearchKindIcons(scope, ctx)
		case "join":
			return callJoin(args, scope, ctx)
		default:
			return ""
	}
}

function callPipe(
	args: readonly Arg[],
	scope: TemplateScope,
	ctx: TemplateContext,
	pipeFn: (value: unknown) => string,
): string {
	const value = evaluateArgAsPrimitive(args[0], scope, ctx)
	return pipeFn(value)
}

function callT(args: readonly Arg[], ctx: TemplateContext): string {
	const key = evaluateArgAsString(args[0])
	if (key.length === 0) return ""
	const map = ctx.manifest.i18n
	if (map === undefined) return ""
	const value = map[key]
	if (value === undefined) return ""
	return resolveLocaleString(value, ctx.locale)
}

function callIcon(args: readonly Arg[], ctx: TemplateContext): React.ReactNode {
	const name = evaluateArgAsString(args[0])
	if (name.length === 0) return null
	return Icon({ icon: { kind: "icon", name }, className: ctx.iconClassName })
}

function callAsset(
	args: readonly Arg[],
	ctx: TemplateContext,
): React.ReactNode {
	const path = evaluateArgAsString(args[0])
	if (path.length === 0) return null
	const ref = parseIconRef(path, ctx.pluginId)
	if (ref === undefined) return null
	return Icon({ icon: ref, className: ctx.iconClassName })
}

function callKind(
	args: readonly Arg[],
	scope: TemplateScope,
	ctx: TemplateContext,
): React.ReactNode {
	const key = evaluateArgAsString(args[0])
	if (key.length === 0) return null
	const kinds = ctx.manifest.ui?.search?.kinds
	if (kinds === undefined) return null
	const match = kinds.find((k) => k.key === key)
	if (match === undefined || match.icon === undefined) return null
	const rendered = renderCardTemplate(match.icon, scope, ctx)
	if (rendered === null || rendered === undefined || rendered === "")
		return null
	return rendered
}

function callSearchKindIcons(
	scope: TemplateScope,
	ctx: TemplateContext,
): readonly React.ReactNode[] {
	if (
		scope.searchMeta === undefined ||
		scope.searchMeta === null ||
		typeof scope.searchMeta !== "object"
	)
		return []
	const facets = (scope.searchMeta as Record<string, unknown>).facets
	if (facets === undefined || typeof facets !== "object" || facets === null)
		return []
	const kinds = ctx.manifest.ui?.search?.kinds
	if (kinds === undefined) return []
	const results: React.ReactNode[] = []
	for (const kind of kinds) {
		if (kind.icon === undefined) continue
		const active = (facets as Record<string, boolean>)[kind.key]
		if (active !== true) continue
		const rendered = renderCardTemplate(kind.icon, scope, ctx)
		if (rendered === null || rendered === undefined || rendered === "") continue
		results.push(rendered)
	}
	return results
}

function callJoin(
	args: readonly Arg[],
	scope: TemplateScope,
	ctx: TemplateContext,
): string | readonly React.ReactNode[] {
	if (args.length === 0) return ""

	const separator = evaluateArgAsString(args[0])
	const items: React.ReactNode[] = []
	for (let i = 1; i < args.length; i++) {
		const val = evaluateArg(args[i], scope, ctx)
		if (Array.isArray(val)) {
			for (const item of val) {
				if (item !== null && item !== undefined && item !== "") {
					items.push(item)
				}
			}
			continue
		}
		if (val !== null && val !== undefined && val !== "") {
			items.push(val)
		}
	}
	if (items.length === 0) return ""
	if (items.every((item) => typeof item === "string")) {
		return (items as readonly string[]).join(separator)
	}
	if (separator.length === 0) return items
	const interleaved: React.ReactNode[] = []
	for (let i = 0; i < items.length; i++) {
		if (i > 0) interleaved.push(separator)
		interleaved.push(items[i])
	}
	return interleaved
}

// ── Argument helpers ─────────────────────────────────────────────────────────

function evaluateArgAsPrimitive(
	arg: Arg | undefined,
	scope: TemplateScope,
	ctx: TemplateContext,
): unknown {
	if (arg === undefined) return undefined
	if (arg.kind === "string") return arg.value
	if (arg.expr.kind === "path") {
		const segments = arg.expr.segments
		if (segments.length === 1) {
			const seg = segments[0]!
			const num = Number(seg)
			if (!Number.isNaN(num)) return num
		}
		return resolvePath(segments, scope)
	}
	if (arg.expr.kind === "call") {
		const result = evaluateCall(arg.expr.name, arg.expr.args, scope, ctx)
		if (typeof result === "string" || typeof result === "number") return result
		if (Array.isArray(result)) return result
		return undefined
	}
	return undefined
}

function evaluateArg(
	arg: Arg | undefined,
	scope: TemplateScope,
	ctx: TemplateContext,
): EvalValue {
	if (arg === undefined) return undefined
	if (arg.kind === "string") return arg.value
	return evaluateExpression(arg.expr, scope, ctx)
}

function compareCall(
	args: readonly Arg[],
	scope: TemplateScope,
	ctx: TemplateContext,
	cmp: (a: unknown, b: unknown) => boolean,
): string {
	const a = evaluateArgAsPrimitive(args[0], scope, ctx)
	const b = evaluateArgAsPrimitive(args[1], scope, ctx)
	return cmp(a, b) ? "true" : ""
}

function callIf(
	args: readonly Arg[],
	scope: TemplateScope,
	ctx: TemplateContext,
): EvalValue {
	const cond = evaluateArgAsPrimitive(args[0], scope, ctx)
	const truthy =
		cond !== undefined &&
		cond !== null &&
		cond !== "" &&
		cond !== false &&
		cond !== 0
	if (truthy) {
		const raw = evaluateArgAsPrimitive(args[1], scope, ctx)
		if (raw !== undefined) return raw as EvalValue
		return evaluateArg(args[1], scope, ctx)
	}
	if (args.length > 2) {
		const raw = evaluateArgAsPrimitive(args[2], scope, ctx)
		if (raw !== undefined) return raw as EvalValue
		return evaluateArg(args[2], scope, ctx)
	}
	return ""
}

function evaluateArgAsString(arg: Arg | undefined): string {
	if (arg === undefined) return ""
	if (arg.kind === "string") return arg.value
	return ""
}

// ── Pipe functions ───────────────────────────────────────────────────────────

function pipeBytes(value: unknown): string {
	if (typeof value !== "number") return ""
	return formatBytes(value)
}

function pipeDuration(value: unknown): string {
	if (typeof value !== "number") return ""
	return formatClockDuration(value)
}

function pipeNumber(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return ""
	return value.toLocaleString()
}

function pipeInc(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return ""
	return String(value + 1)
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Render one res-card template string. Returns a ReactNode so that
 * icon-producing functions (`icon`, `asset`, `kind`) can inject
 * components inline with text.
 */
export function renderCardTemplate(
	template: string,
	scope: TemplateScope,
	ctx: TemplateContext,
): React.ReactNode {
	if (template.length === 0) return ""
	const fragments = parseTemplateFragments(template)
	if (fragments.length === 0) return ""

	const results: React.ReactNode[] = []
	for (const frag of fragments) {
		if (frag.kind === "text") {
			results.push(frag.value)
			continue
		}
		const expr = parseTemplateExpression(frag.source)
		if (expr === undefined) {
			continue
		}
		const value = evaluateExpression(expr, scope, ctx)
		if (value !== null && value !== undefined && value !== "") {
			results.push(value)
		}
	}

	if (results.length === 0) return null
	if (results.length === 1) return results[0]
	const allStrings = results.every((r) => typeof r === "string")
	if (allStrings) return results.join("")
	return results
}

/** Render every badge in a {@link CoverKindUi} slot array. */
export function renderSlotBadges(
	slotValues: readonly string[],
	scope: TemplateScope,
	ctx: TemplateContext,
): readonly React.ReactNode[] {
	return slotValues
		.map((template) => renderCardTemplate(template, scope, ctx))
		.filter((n): n is Exclude<typeof n, null | undefined | ""> => {
			if (n === null || n === undefined || n === "") return false
			if (Array.isArray(n) && n.length === 0) return false
			return true
		})
}
