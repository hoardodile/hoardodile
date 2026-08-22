import type { PluginManifest } from "@hoardodile/sdk-types"
import {
	parseTemplateExpression,
	parseTemplateFragments,
	type TemplateArg,
	type TemplateExpr,
	tokeniseExpression,
} from "@hoardodile/sdk-types/template"

/**
 * Build-time validation of the manifest's host-rendered template
 * strings (`ui.card` corners, `ui.search` labels/icons, `ui.message`
 * anchors). Runs the same grammar the web renderer evaluates — shared
 * from `@hoardodile/sdk-types/template` — so a template that passes here
 * renders in the app, and the mistakes that would silently render
 * empty covers (malformed expressions, unbalanced parentheses,
 * unknown functions, undeclared i18n keys) fail the build.
 */

/** Function names the host's template engine recognizes. */
const KNOWN_FUNCTIONS = new Set([
	"asset",
	"bytes",
	"duration",
	"eq",
	"gt",
	"gte",
	"icon",
	"if",
	"inc",
	"join",
	"kind",
	"lt",
	"lte",
	"ne",
	"number",
	"searchKindIcons",
	"t",
])

export type TemplateLintIssue = {
	readonly template: string
	readonly message: string
}

/**
 * Validate one template string. Returns a list of problems; empty
 * means the template is well-formed.
 */
export function lintTemplate(
	template: string,
	i18nKeys: ReadonlySet<string>,
): readonly TemplateLintIssue[] {
	const issues: TemplateLintIssue[] = []

	const open = (template.match(/\{\{/g) ?? []).length
	const close = (template.match(/\}\}/g) ?? []).length
	if (open !== close) {
		return [
			{
				template,
				message: `unbalanced {{ }} braces (${open} open, ${close} close)`,
			},
		]
	}

	for (const fragment of parseTemplateFragments(template)) {
		if (fragment.kind !== "expr") continue
		lintExpression(fragment.source, template, i18nKeys, issues)
	}
	return issues
}

function lintExpression(
	source: string,
	template: string,
	i18nKeys: ReadonlySet<string>,
	issues: TemplateLintIssue[],
): void {
	const tokens = tokeniseExpression(source)
	const opens = tokens.filter((t) => t.kind === "lparen").length
	const closes = tokens.filter((t) => t.kind === "rparen").length
	if (opens !== closes) {
		issues.push({
			template,
			message: `unbalanced parentheses in {{${source}}} (${opens} open, ${closes} close)`,
		})
		return
	}
	const expr = parseTemplateExpression(source)
	if (expr === undefined) {
		issues.push({
			template,
			message: `cannot parse expression "{{${source}}}" (expected a call or path)`,
		})
		return
	}
	walkExpr(expr, (call) => {
		if (!KNOWN_FUNCTIONS.has(call.name)) {
			issues.push({
				template,
				message: `unknown function "${call.name}" (known: ${[...KNOWN_FUNCTIONS].join(", ")})`,
			})
			return
		}
		if (call.name === "t") {
			const key = firstStringArg(call.args)
			if (key !== undefined && !i18nKeys.has(key)) {
				issues.push({
					template,
					message: `t('${key}') references an i18n key the manifest does not declare`,
				})
			}
		}
	})
}

/** Visit every call node of the AST, nested calls included. */
function walkExpr(
	expr: TemplateExpr,
	visit: (call: Extract<TemplateExpr, { readonly kind: "call" }>) => void,
): void {
	if (expr.kind !== "call") return
	visit(expr)
	for (const arg of expr.args) {
		if (arg.kind === "expr") walkExpr(arg.expr, visit)
	}
}

/** First string literal argument of `fn('...', ...)`, if any. */
function firstStringArg(args: readonly TemplateArg[]): string | undefined {
	const first = args[0]
	if (first?.kind === "string") return first.value
	return undefined
}

/** Collect every template string the manifest declares. */
export function manifestTemplates(manifest: PluginManifest): readonly string[] {
	const templates: string[] = []
	for (const block of Object.values(manifest.ui?.card ?? {})) {
		if (block === undefined) continue
		for (const corner of [block.tl, block.tr, block.bl, block.br]) {
			if (corner !== undefined) templates.push(...corner)
		}
	}
	for (const kind of manifest.ui?.search?.kinds ?? []) {
		templates.push(kind.label)
		if (kind.icon !== undefined) templates.push(kind.icon)
	}
	if (manifest.ui?.message?.anchor !== undefined) {
		templates.push(manifest.ui.message.anchor)
	}
	return templates
}

/**
 * Lint every template in the manifest. Returns the declared i18n keys
 * plus the issues found; callers decide how strict to be.
 */
export function lintManifestTemplates(manifest: PluginManifest): {
	readonly templates: readonly string[]
	readonly issues: readonly TemplateLintIssue[]
} {
	const templates = manifestTemplates(manifest)
	// `i18n` maps label key → { locale: label } (the host's template
	// engine looks up `manifest.i18n[key]` then resolves the locale).
	const i18nKeys = new Set(Object.keys(manifest.i18n ?? {}))
	const issues: TemplateLintIssue[] = []
	for (const template of templates) {
		issues.push(...lintTemplate(template, i18nKeys))
	}
	return { templates, issues }
}
