/**
 * Monolingual copy checks for the demo seed catalog. A field may be any
 * one language; mixing CJK/Hangul with Latin letters in the same string
 * is the failure the catalog tests catch (e.g. "湖边 Sunset").
 */

const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/
const CJK_OR_HANGUL =
	/[\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u3400-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF66-\uFF9F]/

export type SeedLang = "zh" | "en" | "ja" | "ko" | "fr" | "de" | "es"

export type Copy = {
	readonly lang: SeedLang
	readonly text: string
}

/** True when `text` mixes Latin letters with CJK or Hangul. */
export function mixesScripts(text: string): boolean {
	return LATIN_LETTER.test(text) && CJK_OR_HANGUL.test(text)
}

/**
 * Assert a user-visible catalog string is monolingual. Empty strings pass.
 * URLs are not checked here — callers skip `sourceUrl`.
 */
export function assertMonolingual(copy: Copy, label: string): void {
	if (copy.text.length === 0) return
	if (!mixesScripts(copy.text)) return
	throw new Error(`mixed-script copy at ${label}: ${JSON.stringify(copy.text)}`)
}
