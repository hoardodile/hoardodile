import type { ReactNode } from "react"

/**
 * Slot-based renderer for the loading/empty/error/data quartet that
 * wraps almost every list query in the app. Reduces:
 *
 * ```tsx
 * {q.isLoading ? <Skeleton/> : null}
 * {!q.isLoading && q.isError ? <Error/> : null}
 * {!q.isLoading && !q.isError && data.length === 0 ? <Empty/> : null}
 * {!q.isLoading && !q.isError && data.length > 0 ? <List data={data}/> : null}
 * ```
 *
 * to a single declarative element. Pass a `result` describing the
 * query's status, a derived `data`, and the slot renderers.
 *
 * Decoupled from TanStack Query so it can be used with any data source
 * (URL state, suspense, manual fetches) and stays cheap to test.
 */
export type QueryStateResult<T> = {
	readonly isLoading: boolean
	readonly isError: boolean
	readonly error?: Error | null
	readonly data: T | undefined
}

export type QueryStateViewProps<T> = {
	readonly result: QueryStateResult<T>
	readonly isEmpty?: (data: T) => boolean
	readonly loading: ReactNode
	readonly empty?: ReactNode
	readonly error?: (error: Error) => ReactNode
	readonly children: (data: T) => ReactNode
}

export function QueryStateView<T>(props: QueryStateViewProps<T>): ReactNode {
	const { result, isEmpty, loading, empty, error, children } = props
	if (result.isLoading) return loading
	if (result.isError) {
		const renderError = error
		const err = result.error ?? new Error("Unknown error")
		return renderError !== undefined ? renderError(err) : null
	}
	if (result.data === undefined) return null
	if (isEmpty?.(result.data) === true) return empty ?? null
	return children(result.data)
}
