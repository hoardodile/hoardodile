import { toast } from "@hoardodile/ui/components/toast"
import {
	type QueryClient,
	type UseMutationOptions,
	type UseMutationResult,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { errorMessage } from "@/lib/errors"

/**
 * The library's own mutation-success callback shape, kept so callers pass
 * `onSuccess` exactly as they would to `useMutation` and the hook chains it
 * after the invalidate + toast steps.
 */
type MutationSuccessFn<TInput, TOutput> = NonNullable<
	UseMutationOptions<TOutput, Error, TInput>["onSuccess"]
>

/**
 * Wires up the canonical toast-driven mutation lifecycle used across the
 * app: on success, invalidate the relevant queries, show a success toast,
 * then run any extra `onSuccess` side effect; on error, surface the
 * server's message (falling back to a generic key). This is the shared
 * core behind `useSaveMutation` / `useDeleteMutation` / `useReorderMutation`
 * and the one-off mutations that pair a success toast with extra side
 * effects.
 *
 * The success toast is omitted when {@link ToastMutationConfig.successToastKey}
 * is not set; the error toast always fires.
 */
export type ToastMutationConfig<TInput, TOutput = unknown> = {
	/** Queries to invalidate after success, before the toast and side effect. */
	readonly invalidate?: (
		qc: QueryClient,
		result: TOutput,
		input: TInput,
	) => Promise<void>
	/** Success toast translation key; omitted → no success toast. */
	readonly successToastKey?: string
	/** Error toast fallback translation key; default `common.unknownError`. */
	readonly errorToastKey?: string
	/**
	 * Error toast title resolver; overrides the default "server message or
	 * fallback key" behavior (e.g. for mapping server domain errors to
	 * localized copy).
	 */
	readonly resolveError?: (err: unknown, t: TFunction) => string
	/** Extra side effect after success (runs after invalidate + toast). */
	readonly onSuccess?: MutationSuccessFn<TInput, TOutput>
} & Omit<UseMutationOptions<TOutput, Error, TInput>, "onSuccess">

export function useToastMutation<TInput, TOutput = unknown>(
	config: ToastMutationConfig<TInput, TOutput>,
): UseMutationResult<TOutput, Error, TInput> {
	const qc = useQueryClient()
	const { t } = useTranslation()
	const errorKey = config.errorToastKey ?? "common.unknownError"
	const {
		invalidate,
		successToastKey,
		errorToastKey,
		resolveError,
		onSuccess,
		onError,
		...options
	} = config
	return useMutation({
		...options,
		onSuccess: async (
			...args: Parameters<MutationSuccessFn<TInput, TOutput>>
		) => {
			const [result, input] = args
			if (invalidate !== undefined) await invalidate(qc, result, input)
			if (successToastKey !== undefined) {
				toast.add({ title: t(successToastKey), type: "success" })
			}
			await onSuccess?.(...args)
		},
		onError: (err, vars, onMutateResult, context) => {
			// The caller's native onError runs first (it may want the raw
			// mutation context); the error toast always fires.
			onError?.(err, vars, onMutateResult, context)
			const title =
				resolveError !== undefined
					? resolveError(err, t)
					: errorMessage(err, t(errorKey))
			toast.add({ title, type: "error" })
		},
	})
}
