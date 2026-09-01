/**
 * `biome.json` for a scaffolded standalone plugin. It cannot live inside
 * `plugins/template`: biome 2.x rejects a nested root config when one
 * already exists, and the monorepo has a root `biome.json` — so the
 * scaffolder writes this config into each generated plugin instead. It
 * mirrors hoardodile's config (tab indent, double quotes, asNeeded
 * semicolons, organizeImports, the recommended linter with the same
 * rule offs, Tailwind directive parsing) minus monorepo-only excludes.
 */
export const STANDALONE_BIOME_JSON = `{
	"$schema": "https://biomejs.dev/schemas/2.5.10/schema.json",
	"vcs": {
		"enabled": true,
		"clientKind": "git",
		"useIgnoreFile": true
	},
	"css": {
		"parser": {
			"tailwindDirectives": true
		}
	},
	"files": {
		"ignoreUnknown": true,
		"includes": [
			"**",
			"!**/vendor",
			"!**/coverage",
			"!**/dist",
			"!**/out",
			"!**/node_modules",
			"!.turbo",
			"!release"
		]
	},
	"formatter": {
		"enabled": true,
		"indentStyle": "tab"
	},
	"linter": {
		"enabled": true,
		"rules": {
			"preset": "recommended",
			"a11y": {
				"noSvgWithoutTitle": "off",
				"noStaticElementInteractions": "off"
			},
			"style": {
				"noNonNullAssertion": "off",
				"useTemplate": "error"
			},
			"suspicious": {
				"noArrayIndexKey": "off",
				"noUnknownAtRules": "off",
				"noExplicitAny": "off",
				"noUndeclaredEnvVars": "off"
			},
			"security": {
				"noDangerouslySetInnerHtml": "off"
			},
			"correctness": {
				"noSelfAssign": "off",
				"useExhaustiveDependencies": "off"
			},
			"performance": {
				"noImgElement": "off"
			},
			"complexity": {
				"noImportantStyles": "off"
			}
		}
	},
	"javascript": {
		"formatter": {
			"quoteStyle": "double",
			"semicolons": "asNeeded"
		}
	},
	"assist": {
		"enabled": true,
		"actions": {
			"source": {
				"organizeImports": "on"
			}
		}
	}
}
`
