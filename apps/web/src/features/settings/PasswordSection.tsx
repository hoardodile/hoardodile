import { changePasswordRequest } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@hoardodile/ui/components/form"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { toast } from "@hoardodile/ui/components/toast"
import { LockPassword } from "@hoardodile/ui/icons/registry"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { changePassword, HttpError } from "@/features/auth"
import { SettingsSection } from "./SettingsSection"

/**
 * Password change action rendered as a flat setting row on the "Me" page.
 * Opens a dialog requiring the current password (proof of possession)
 * plus the replacement. Existing sessions stay valid after the change.
 */
export function PasswordSection() {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)

	return (
		<>
			<SettingsSection
				icon={LockPassword}
				title={t("me.password.title")}
				description={t("me.password.description")}
				layout="compact"
				data-testid="password-row"
			>
				<Button
					variant="secondary"
					onClick={() => setOpen(true)}
					data-testid="change-password"
				>
					<Icon icon={LockPassword} />
					{t("me.password.changeButton")}
				</Button>
			</SettingsSection>
			<ChangePasswordDialog open={open} onOpenChange={setOpen} />
		</>
	)
}

/** `changePasswordRequest` plus the client-side confirm field. */
const changePasswordFormSchema = changePasswordRequest.extend({
	confirm: z.string(),
})

type ChangePasswordValues = z.infer<typeof changePasswordFormSchema>

function ChangePasswordDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { open, onOpenChange } = props
	const { t } = useTranslation()

	const form = useForm<ChangePasswordValues>({
		resolver: standardSchemaResolver(changePasswordFormSchema),
		defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
		mode: "onSubmit",
	})

	useEffect(() => {
		if (!open) return
		form.reset()
	}, [open, form])

	const mutation = useMutation({
		mutationFn: changePassword,
		onSuccess: () => {
			toast.add({ title: t("me.password.changed"), type: "success" })
			onOpenChange(false)
		},
		onError: (err) => {
			if (err instanceof HttpError && err.status === 403) {
				form.setError("currentPassword", {
					type: "server",
					message: t("me.password.errorIncorrect"),
				})
				return
			}
			toast.add({ title: t("me.password.errorGeneric"), type: "error" })
		},
	})

	function handleSubmit(values: ChangePasswordValues) {
		if (values.newPassword !== values.confirm) {
			form.setError("confirm", {
				type: "manual",
				message: t("me.password.mismatch"),
			})
			return
		}
		mutation.mutate({
			currentPassword: values.currentPassword,
			newPassword: values.newPassword,
		})
	}

	const footer = (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => onOpenChange(false)}
				disabled={mutation.isPending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				onClick={form.handleSubmit(handleSubmit)}
				disabled={mutation.isPending}
				data-testid="password-save"
			>
				{mutation.isPending ? t("common.saving") : t("common.save")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("me.password.dialogTitle")}
			footer={footer}
			contentTestId="change-password-dialog"
		>
			<Form {...form}>
				<form
					noValidate
					onSubmit={form.handleSubmit(handleSubmit)}
					className="flex flex-col gap-3"
				>
					<FormField
						control={form.control}
						name="currentPassword"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("me.password.currentPassword")}</FormLabel>
								<FormControl>
									<Input
										type="password"
										autoComplete="current-password"
										autoFocus
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="newPassword"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("me.password.newPassword")}</FormLabel>
								<FormControl>
									<Input
										type="password"
										autoComplete="new-password"
										placeholder={t("me.password.newPasswordPlaceholder")}
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="confirm"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("me.password.confirm")}</FormLabel>
								<FormControl>
									<Input
										type="password"
										autoComplete="new-password"
										placeholder={t("me.password.confirmPlaceholder")}
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</form>
			</Form>
		</AppDialog>
	)
}
