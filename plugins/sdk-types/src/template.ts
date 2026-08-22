/**
 * The host's cover/message template grammar: fragment splitting, the
 * expression tokeniser and the recursive-descent parser. Pure logic
 * with no DOM or React — shared verbatim by the web renderer
 * (`apps/web/src/features/res/template/render.ts`) and the CLI's
 * build-time template lint (`packages/cli`), so the linter can never
 * drift from what the engine actually renders.
 *
 * The parser is deliberately lenient: a partial parse recovers and the
 * evaluator renders what it can (bad expressions render as the empty
 * string). Strictness belongs to the lint tooling, which inspects the
 * tokens and the AST on top of this grammar.
 */

const TEMPLATE_RE = /\{\{(.*?)\}\}/g

export type TemplateFragment =
	| { readonly kind: "text"; readonly value: string }
	| { readonly kind: "expr"; readonly source: string }

/** Split a template into literal text and `{{...}}` expression fragments. */
export function parseTemplateFragments(
	template: string,
): readonly TemplateFragment[] {
	const fragments: TemplateFragment[] = []
	let lastIndex = 0
	for (const match of template.matchAll(TEMPLATE_RE)) {
		const start = match.index ?? 0
		if (start > lastIndex) {
			fragments.push({ kind: "text", value: template.slice(lastIndex, start) })
		}
		fragments.push({ kind: "expr", source: match[1] ?? "" })
		lastIndex = start + match[0].length
	}
	if (lastIndex < template.length) {
		fragments.push({ kind: "text", value: template.slice(lastIndex) })
	}
	return fragments
}

export type TemplateToken =
	| { readonly kind: "ident"; readonly value: string }
	| { readonly kind: "dot" }
	| { readonly kind: "lparen" }
	| { readonly kind: "rparen" }
	| { readonly kind: "comma" }
	| { readonly kind: "string"; readonly value: string }
	| { readonly kind: "eof" }

/** Tokenise one expression body (the inside of `{{...}}`). */
export function tokeniseExpression(source: string): TemplateToken[] {
	const tokens: TemplateToken[] = []
	let i = 0
	while (i < source.length) {
		const ch = source[i]!
		if (/\s/.test(ch)) {
			i++
			continue
		}
		if (ch === ".") {
			tokens.push({ kind: "dot" })
			i++
			continue
		}
		if (ch === "(") {
			tokens.push({ kind: "lparen" })
			i++
			continue
		}
		if (ch === ")") {
			tokens.push({ kind: "rparen" })
			i++
			continue
		}
		if (ch === ",") {
			tokens.push({ kind: "comma" })
			i++
			continue
		}
		if (ch === "'") {
			let j = i + 1
			while (j < source.length && source[j] !== "'") {
				j++
			}
			tokens.push({ kind: "string", value: source.slice(i + 1, j) })
			i = j + 1
			continue
		}
		if (/[A-Za-z0-9_]/.test(ch)) {
			let j = i
			while (j < source.length && /[A-Za-z0-9_]/.test(source[j]!)) {
				j++
			}
			tokens.push({ kind: "ident", value: source.slice(i, j) })
			i = j
			continue
		}
		// Unrecognised character — skip; the evaluator renders the
		// resulting expression as the empty string.
		i++
	}
	tokens.push({ kind: "eof" })
	return tokens
}

export type TemplateExpr =
	| { readonly kind: "path"; readonly segments: readonly string[] }
	| {
			readonly kind: "call"
			readonly name: string
			readonly args: readonly TemplateArg[]
	  }

export type TemplateArg =
	| { readonly kind: "expr"; readonly expr: TemplateExpr }
	| { readonly kind: "string"; readonly value: string }

class Parser {
	readonly tokens: TemplateToken[]
	pos = 0
	constructor(tokens: TemplateToken[]) {
		this.tokens = tokens
	}

	peek(): TemplateToken {
		return this.tokens[this.pos] ?? { kind: "eof" }
	}

	advance(): TemplateToken {
		const t = this.tokens[this.pos]
		this.pos++
		return t ?? { kind: "eof" }
	}
}

function parseExpr(parser: Parser): TemplateExpr | undefined {
	const t = parser.peek()
	if (t.kind !== "ident") return undefined
	parser.advance()

	const next = parser.peek()
	if (next.kind === "lparen") {
		// call
		parser.advance() // consume (
		const args: TemplateArg[] = []
		if (parser.peek().kind !== "rparen") {
			while (true) {
				const arg = parseArg(parser)
				if (arg === undefined) break
				args.push(arg)
				if (parser.peek().kind === "comma") {
					parser.advance()
					continue
				}
				break
			}
		}
		if (parser.peek().kind === "rparen") {
			parser.advance()
		}
		return { kind: "call", name: t.value, args }
	}

	// path
	const segments = [t.value]
	while (parser.peek().kind === "dot") {
		parser.advance()
		const seg = parser.peek()
		if (seg.kind !== "ident") break
		parser.advance()
		segments.push(seg.value)
	}
	return { kind: "path", segments }
}

function parseArg(parser: Parser): TemplateArg | undefined {
	const t = parser.peek()
	if (t.kind === "string") {
		parser.advance()
		return { kind: "string", value: t.value }
	}
	const expr = parseExpr(parser)
	if (expr === undefined) return undefined
	return { kind: "expr", expr }
}

/**
 * Parse one expression body (`{{...}}` contents) into an AST. Returns
 * `undefined` when the expression does not start with an identifier —
 * a call or path head is required. Note the parser is lenient about
 * the *tail*: unbalanced parentheses recover into a partial AST (the
 * evaluator renders what it can); use {@link tokeniseExpression} and
 * check paren balance yourself when strictness matters.
 */
export function parseTemplateExpression(
	source: string,
): TemplateExpr | undefined {
	return parseExpr(new Parser(tokeniseExpression(source)))
}
