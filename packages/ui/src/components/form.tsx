import { useRender } from "@base-ui/react/use-render"
import { Label } from "@hoardodile/ui/components/label"
import {
	FormFieldContext,
	FormItemContext,
	useFormField,
} from "@hoardodile/ui/hooks/use-form-field"
import { cn } from "@hoardodile/ui/lib/utils"
import * as React from "react"
import {
	Controller,
	type ControllerProps,
	type FieldPath,
	type FieldValues,
	FormProvider,
} from "react-hook-form"

const Form = FormProvider

const FormField = <
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
	...props
}: ControllerProps<TFieldValues, TName>) => {
	return (
		<FormFieldContext.Provider value={{ name: props.name }}>
			<Controller {...props} />
		</FormFieldContext.Provider>
	)
}

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
	const id = React.useId()

	return (
		<FormItemContext.Provider value={{ id }}>
			<div
				data-slot="form-item"
				className={cn("grid gap-2", className)}
				{...props}
			/>
		</FormItemContext.Provider>
	)
}

function FormLabel({
	className,
	...props
}: React.ComponentProps<typeof Label>) {
	const { error, formItemId } = useFormField()

	return (
		<Label
			data-slot="form-label"
			data-error={!!error}
			className={cn("data-[error=true]:text-destructive", className)}
			htmlFor={formItemId}
			{...props}
		/>
	)
}

function FormControl({ children }: { children: React.ReactElement }) {
	const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

	return useRender({
		render: children,
		props: {
			"data-slot": "form-control",
			id: formItemId,
			"aria-describedby": error
				? `${formDescriptionId} ${formMessageId}`
				: formDescriptionId,
			"aria-invalid": !!error,
		},
	})
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
	const { formDescriptionId } = useFormField()

	return (
		<p
			data-slot="form-description"
			id={formDescriptionId}
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	)
}

function FormMessage({
	className,
	children,
	...props
}: React.ComponentProps<"p">) {
	const { error, formMessageId } = useFormField()
	const body = error ? String(error.message ?? "") : children

	if (!body) {
		return null
	}

	return (
		<p
			data-slot="form-message"
			id={formMessageId}
			role="alert"
			className={cn("text-sm text-destructive", className)}
			{...props}
		>
			{body}
		</p>
	)
}

export {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
	useFormField,
}
