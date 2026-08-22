import * as React from "react"
import {
	type FieldPath,
	type FieldValues,
	useFormContext,
	useFormState,
} from "react-hook-form"

/**
 * Field-state plumbing shared by the `Form*` components in
 * `@hoardodile/ui/components/form`: connects a `<FormField>` (the
 * react-hook-form `Controller` wrapper) to its `<FormItem>` via two
 * private contexts and exposes the resolved field state — id parts and
 * error — to the label/control/description/message render pieces.
 */

type FormFieldContextValue<
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
	name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue | undefined>(
	undefined,
)

type FormItemContextValue = {
	id: string
}

const FormItemContext = React.createContext<FormItemContextValue | undefined>(
	undefined,
)

function useFormField() {
	const fieldContext = React.useContext(FormFieldContext)
	const itemContext = React.useContext(FormItemContext)
	const { getFieldState } = useFormContext()
	const formState = useFormState({ name: fieldContext?.name })

	if (!fieldContext) {
		throw new Error("useFormField should be used within <FormField>")
	}
	if (!itemContext) {
		throw new Error("useFormField should be used within <FormItem>")
	}

	const fieldState = getFieldState(fieldContext.name, formState)
	const { id } = itemContext

	return {
		id,
		name: fieldContext.name,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`,
		...fieldState,
	}
}

export { FormFieldContext, FormItemContext, useFormField }
