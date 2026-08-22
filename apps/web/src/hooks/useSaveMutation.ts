import type {
	QueryClient,
	UseMutationOptions,
	UseMutationResult,
} from "@tanstack/react-query"
import { useToastMutation } from "@/hooks/useToastMutation"

/**
 * Wires up the canonical "save" mutation lifecycle used by edit panels
 * across the app: on success, invalidate the relevant queries, show the
 * shared "saved" toast, and notify the parent so it can close its dialog;
 * on error, surface the server's message (falling back to a generic
 * "save failed" toast). Eliminates ~10 identical copies of this block.
 *
 * The translation keys default to `common.saved` / `common.saveFailed`;
 * callers with feature-specific copy override via {@link successMessageKey}
 * / {@link errorMessageKey}.
 */
export type SaveMutationConfig<TInput, TOutput> = {
	readonly mutationOptions: UseMutationOptions<TOutput, Error, TInput>
	readonly invalidate: (qc: QueryClient) => Promise<void>
	readonly onSaved?: () => void
	readonly successMessageKey?: string
	readonly errorMessageKey?: string
	/** Extra side effect on error, run in addition to the error toast. */
	readonly onSaveError?: (err: unknown, input: TInput) => void
}

export function useSaveMutation<TInput, TOutput>(
	config: SaveMutationConfig<TInput, TOutput>,
): UseMutationResult<TOutput, Error, TInput> {
	return useToastMutation({
		...config.mutationOptions,
		invalidate: config.invalidate,
		successToastKey: config.successMessageKey ?? "common.saved",
		errorToastKey: config.errorMessageKey ?? "common.saveFailed",
		onError: (err, input) => {
			config.onSaveError?.(err, input)
		},
		onSuccess: config.onSaved,
	})
}
