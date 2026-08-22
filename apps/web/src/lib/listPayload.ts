import { isEmptyObject } from "es-toolkit"

/**
 * Small leaf composables for normalizing list-payload inputs sent to
 * server-side `list` procedures. Centralizing these collapses the
 * "empty → undefined" ternaries that otherwise repeat across every
 * domain's query builder.
 *
 * They also detach the wire shape from the UI shape: views can hold
 * `readonly` collections without having to clone them at every callsite.
 */

export function nonEmptyString(v: string): string | undefined {
	return v.length > 0 ? v : undefined
}

export function nonEmptyArray<T>(v: readonly T[] | undefined): T[] | undefined {
	if (v === undefined || v.length === 0) return undefined
	return [...v]
}

export function nonEmptyRecord<V>(
	v: Readonly<Record<string, V>> | undefined,
): Record<string, V> | undefined {
	if (v === undefined || isEmptyObject(v)) return undefined
	return { ...v }
}

export function trueOrUndefined(v: boolean | undefined): true | undefined {
	return v === true ? true : undefined
}
