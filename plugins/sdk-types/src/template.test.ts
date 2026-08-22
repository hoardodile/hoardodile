import { describe, expect, test } from "vitest"
import {
	parseTemplateExpression,
	parseTemplateFragments,
	tokeniseExpression,
} from "./template.ts"

describe("parseTemplateFragments", () => {
	test("splits text and expressions, keeping the {{ }} contents", () => {
		expect(parseTemplateFragments("P{{file.count}}Q{{t('x')}}")).toEqual([
			{ kind: "text", value: "P" },
			{ kind: "expr", source: "file.count" },
			{ kind: "text", value: "Q" },
			{ kind: "expr", source: "t('x')" },
		])
	})

	test("handles pure text and unbalanced fragments gracefully", () => {
		expect(parseTemplateFragments("plain")).toEqual([
			{ kind: "text", value: "plain" },
		])
		expect(parseTemplateFragments("{{unclosed")).toEqual([
			{ kind: "text", value: "{{unclosed" },
		])
	})
})

describe("tokeniseExpression", () => {
	test("emits the full token vocabulary", () => {
		const tokens = tokeniseExpression("join(' ', a.b, gt(x, 1))")
		expect(tokens.map((t) => t.kind)).toEqual([
			"ident",
			"lparen",
			"string",
			"comma",
			"ident",
			"dot",
			"ident",
			"comma",
			"ident",
			"lparen",
			"ident",
			"comma",
			"ident",
			"rparen",
			"rparen",
			"eof",
		])
	})
})

describe("parseTemplateExpression", () => {
	test("parses paths", () => {
		expect(parseTemplateExpression("file.count")).toEqual({
			kind: "path",
			segments: ["file", "count"],
		})
	})

	test("parses calls with nested args", () => {
		expect(parseTemplateExpression("if(gt(file.count, 1), t('x'))")).toEqual({
			kind: "call",
			name: "if",
			args: [
				{
					kind: "expr",
					expr: {
						kind: "call",
						name: "gt",
						args: [
							{
								kind: "expr",
								expr: { kind: "path", segments: ["file", "count"] },
							},
							{ kind: "expr", expr: { kind: "path", segments: ["1"] } },
						],
					},
				},
				{
					kind: "expr",
					expr: {
						kind: "call",
						name: "t",
						args: [{ kind: "string", value: "x" }],
					},
				},
			],
		})
	})

	test("recovers from a missing closing paren with a partial AST", () => {
		expect(parseTemplateExpression("if(gt(a, b")).toEqual({
			kind: "call",
			name: "if",
			args: [
				{
					kind: "expr",
					expr: {
						kind: "call",
						name: "gt",
						args: [
							{ kind: "expr", expr: { kind: "path", segments: ["a"] } },
							{ kind: "expr", expr: { kind: "path", segments: ["b"] } },
						],
					},
				},
			],
		})
	})

	test("fails on non-identifier heads", () => {
		expect(parseTemplateExpression("(x)")).toBeUndefined()
		expect(parseTemplateExpression("'str'")).toBeUndefined()
		expect(parseTemplateExpression("")).toBeUndefined()
	})
})
