import {
	DialogFooterActions,
	useDialogFooterActions,
} from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Form } from "@hoardodile/ui/components/form"
import { toast } from "@hoardodile/ui/components/toast"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { type UseMutationOptions, useMutation } from "@tanstack/react-query"
import { type ReactNode, useId } from "react"
import {
	type DefaultValues,
	type FieldValues,
	type Resolver,
	type UseFormReturn,
	useForm,
} from "react-hook-form"
import { useTranslation } from "react-i18next"
import type { z } from "zod"
import { errorMessage as resolveErrorMessage } from "@/lib/errors"

/**
 * Generic edit-panel shell. Owns the typical
 * `Form → useForm → useMutation → toast → invalidate → onSaved`
 * lifecycle. Renders inline (no dialog chrome) so it can be embedded in
 * any container — typically a Sheet tab.
 */
export type EntityEditPanelProps<
	TValues extends FieldValues,
	TInput,
	TOutput,
> = {
	readonly ariaLabel?: string
	readonly schema: z.ZodType<TValues>
	readonly defaults: TValues
	readonly mutation: UseMutationOptions<TOutput, Error, TInput>
	readonly buildInput: (values: TValues) => TInput
	readonly invalidate?: (result: TOutput) => Promise<unknown> | undefined
	readonly successMessage?: string
	readonly errorMessage?: string
	readonly submitLabel?: string
	readonly submittingLabel?: string
	readonly submitTestId?: string
	readonly extraContent?: ReactNode
	/** Called after a successful save; the parent typically closes the Sheet. */
	readonly onSaved?: () => void
	readonly children: (form: UseFormReturn<TValues>) => ReactNode
}

export function EntityEditPanel<TValues extends FieldValues, TInput, TOutput>(
	props: EntityEditPanelProps<TValues, TInput, TOutput>,
) {
	const {
		ariaLabel,
		schema,
		defaults,
		mutation: mutationOptions,
		buildInput,
		invalidate,
		successMessage,
		errorMessage,
		submitLabel,
		submittingLabel,
		submitTestId,
		extraContent,
		onSaved,
		children,
	} = props
	const { t } = useTranslation()
	const footerSlot = useDialogFooterActions()
	// The dialog footer's submit button targets this form via its id, so
	// Enter-to-submit semantics survive the move out of the body.
	const formId = useId()
	const resolvedSuccess = successMessage ?? t("common.saved")
	const resolvedError = errorMessage ?? t("common.saveFailed")
	const resolvedSubmit = submitLabel ?? t("common.save")
	const resolvedSubmitting = submittingLabel ?? t("common.saving")

	const form: UseFormReturn<TValues> = useForm<TValues>({
		// Bridge cast: zod's StandardSchemaV1 input type is `unknown`, while RHF
		// constrains the resolver to `FieldValues`. Both shapes are
		// runtime-equivalent for our forms (RHF passes plain objects).
		resolver: standardSchemaResolver(schema as never) as Resolver<TValues>,
		defaultValues: defaults as DefaultValues<TValues>,
	})

	const mutation = useMutation<TOutput, Error, TInput>({
		mutationFn: mutationOptions.mutationFn,
		onSuccess: async (result) => {
			if (invalidate !== undefined) await invalidate(result)
			toast.add({ title: resolvedSuccess, type: "success" })
			onSaved?.()
		},
		onError: (err) => {
			toast.add({
				title: resolveErrorMessage(err, resolvedError),
				type: "error",
			})
		},
	})

	const submitButton = (
		<Button
			type="submit"
			form={formId}
			disabled={mutation.isPending}
			data-testid={submitTestId}
		>
			{mutation.isPending ? resolvedSubmitting : resolvedSubmit}
		</Button>
	)

	return (
		<>
			{extraContent}
			<Form {...form}>
				<form
					id={formId}
					onSubmit={form.handleSubmit((values) =>
						mutation.mutate(buildInput(values)),
					)}
					className="flex flex-col gap-4"
					aria-label={ariaLabel}
				>
					{children(form)}
					{footerSlot === null ? (
						<div className="flex justify-end pt-2">{submitButton}</div>
					) : null}
				</form>
			</Form>
			{footerSlot !== null ? (
				<DialogFooterActions>{submitButton}</DialogFooterActions>
			) : null}
		</>
	)
}
