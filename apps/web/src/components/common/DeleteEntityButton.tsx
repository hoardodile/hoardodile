import type { AppRouter } from "@hoardodile/server/router"
import { Button } from "@hoardodile/ui/components/button"
import { toast } from "@hoardodile/ui/components/toast"
import { Check, Cross } from "@hoardodile/ui/icons/marks"
import { TrashBinMinimalistic } from "@hoardodile/ui/icons/registry"
import { isTRPCClientError, type TRPCClientError } from "@trpc/client"
import { forwardRef, useCallback, useImperativeHandle, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmByTypingDialog } from "./ConfirmByTypingDialog"

export type DeleteEntityButtonHandle = Readonly<{
	beginDelete(): void
}>

export type DeleteEntityButtonProps = Readonly<{
	entityKindLabel: string
	entityName: string
	testId?: string
	onDelete(): Promise<void>
	onForceDelete(typedName: string): Promise<void>
	disabled?: boolean
	usageCount?: number
	usageLabel?: string
	dependencyMessage?: string
	/** Small red trash icon instead of a text "Delete" button */
	compactIcon?: boolean
	/** No visible trigger; call `ref.beginDelete()` (e.g. from a dropdown item) */
	hideTrigger?: boolean
	/**
	 * When there are no known dependencies, how to confirm a normal delete.
	 * `dialog` opens {@link ConfirmDialog}; `inline` uses the armed two-step UI.
	 * If `hideTrigger` is true, this is forced to `dialog`.
	 */
	simpleDeleteConfirm?: "inline" | "dialog"
}>

/**
 * Destructive delete button with dependency-aware UX:
 * - When `usageCount === 0`, delete immediately (no confirmation dialog).
 * - When `usageCount > 0` is provided, clicking opens the force-delete
 *   dialog directly, requiring the user to type the entity's exact name.
 * - Otherwise, falls back to a two-step inline armed flow or a simple
 *   {@link ConfirmDialog} when `simpleDeleteConfirm` is `dialog`; if the server
 *   responds with a `*.has_dependencies` CONFLICT, the same force-delete
 *   dialog opens with the server-provided message.
 * - With `compactIcon`, the trigger is a small red trash icon; armed confirm
 *   uses compact icon buttons.
 */
export const DeleteEntityButton = forwardRef<
	DeleteEntityButtonHandle,
	DeleteEntityButtonProps
>(function DeleteEntityButton(props, ref) {
	const {
		entityKindLabel,
		entityName,
		testId,
		onDelete,
		onForceDelete,
		disabled,
		usageCount,
		usageLabel,
		dependencyMessage,
		compactIcon = false,
		hideTrigger = false,
		simpleDeleteConfirm: simpleDeleteConfirmProp,
	} = props
	const { t } = useTranslation()

	const simpleDeleteConfirm: "inline" | "dialog" = hideTrigger
		? "dialog"
		: (simpleDeleteConfirmProp ?? "inline")

	const hasCustomDependencyMessage =
		dependencyMessage !== undefined && dependencyMessage.length > 0
	const hasKnownDependencies =
		hasCustomDependencyMessage || (usageCount !== undefined && usageCount > 0)

	const [armed, setArmed] = useState(false)
	const [pending, setPending] = useState(false)
	const [forceOpen, setForceOpen] = useState(false)
	const [forceReason, setForceReason] = useState("")
	const [forcePending, setForcePending] = useState(false)
	const [forceTyped, setForceTyped] = useState("")
	const [simpleDialogOpen, setSimpleDialogOpen] = useState(false)
	const [simpleTyped, setSimpleTyped] = useState("")

	function handleSimpleDialogChange(next: boolean) {
		if (!next) {
			setSimpleTyped("")
			setSimpleDialogOpen(false)
		}
	}

	function openForceDialog(reason: string) {
		setForceReason(reason)
		setForceTyped("")
		setForceOpen(true)
	}

	const handleDelete = useCallback(async () => {
		setPending(true)
		try {
			await onDelete()
			toast.add({
				title: t("deleteEntity.toast.deleteSuccess", { kind: entityKindLabel }),
				type: "success",
			})
			setArmed(false)
			setSimpleDialogOpen(false)
		} catch (err) {
			const reason = extractDependencyReason(err)
			if (reason !== undefined) {
				openForceDialog(reason)
				setArmed(false)
				setSimpleDialogOpen(false)
			} else {
				toast.add({
					title: getMessage(err) || t("deleteEntity.toast.deleteFailed"),
					type: "error",
				})
			}
		} finally {
			setPending(false)
		}
	}, [onDelete, t, entityKindLabel])

	const handleInitialClick = useCallback(() => {
		if (!hasKnownDependencies) {
			if (usageCount === 0) {
				void handleDelete()
				return
			}
			if (simpleDeleteConfirm === "dialog") {
				setSimpleTyped("")
				setSimpleDialogOpen(true)
			} else {
				setArmed(true)
			}
			return
		}
		const reason = hasCustomDependencyMessage
			? dependencyMessage
			: t("deleteEntity.usageMessage", {
					kind: entityKindLabel,
					count: usageCount ?? 0,
					usage: usageLabel ?? t("deleteEntity.defaultNoun"),
				})
		openForceDialog(reason)
	}, [
		hasKnownDependencies,
		usageCount,
		handleDelete,
		simpleDeleteConfirm,
		hasCustomDependencyMessage,
		dependencyMessage,
		t,
		entityKindLabel,
		usageLabel,
	])

	useImperativeHandle(ref, () => ({ beginDelete: handleInitialClick }), [
		handleInitialClick,
	])

	async function handleForceDelete(typed: string) {
		if (typed !== entityName) {
			toast.add({ title: t("deleteEntity.toast.nameMismatch"), type: "error" })
			return
		}
		setForcePending(true)
		try {
			await onForceDelete(typed)
			toast.add({
				title: t("deleteEntity.toast.forceDeleteSuccess", {
					kind: entityKindLabel,
				}),
				type: "success",
			})
			setForceOpen(false)
		} catch (err) {
			toast.add({
				title: getMessage(err) || t("deleteEntity.toast.forceDeleteFailed"),
				type: "error",
			})
		} finally {
			setForcePending(false)
		}
	}

	const forceDialog = (
		<ConfirmByTypingDialog
			open={forceOpen}
			onOpenChange={setForceOpen}
			title={t("deleteEntity.forceTitle", { kind: entityKindLabel })}
			description={forceReason}
			targetName={entityName}
			expectedInput={entityName}
			confirmLabel={t("deleteEntity.forceConfirm")}
			pendingLabel={t("deleteEntity.forceDeleting")}
			pending={forcePending}
			destructive={true}
			typed={forceTyped}
			onTypedChange={setForceTyped}
			onConfirm={() => void handleForceDelete(forceTyped)}
			inputTestId={testId !== undefined ? `${testId}-force-input` : undefined}
			confirmTestId={
				testId !== undefined ? `${testId}-force-confirm` : undefined
			}
		/>
	)

	const simpleDeleteDialog = (
		<ConfirmByTypingDialog
			open={simpleDialogOpen}
			onOpenChange={handleSimpleDialogChange}
			title={t("deleteEntity.dialogConfirmTitle", { name: entityName })}
			description={t("deleteEntity.dialogConfirmDescription", {
				kind: entityKindLabel,
			})}
			targetName={entityName}
			expectedInput={entityName}
			typed={simpleTyped}
			onTypedChange={setSimpleTyped}
			pending={pending}
			destructive={true}
			confirmLabel={t("deleteEntity.confirm")}
			pendingLabel={t("deleteEntity.deleting")}
			onConfirm={() => void handleDelete()}
			confirmTestId={
				testId !== undefined ? `${testId}-simple-confirm` : undefined
			}
		/>
	)

	const dialogs = (
		<>
			{simpleDialogOpen ? simpleDeleteDialog : null}
			{forceOpen ? forceDialog : null}
		</>
	)

	if (hideTrigger) {
		return dialogs
	}

	if (armed) {
		if (compactIcon) {
			return (
				<>
					<span className="inline-flex items-center gap-0.5">
						<Button
							type="button"
							variant="destructive"
							size="icon"
							className="h-5 w-5"
							onClick={() => void handleDelete()}
							disabled={disabled || pending}
							aria-label={t("deleteEntity.confirm")}
							data-testid={
								testId !== undefined ? `${testId}-confirm` : undefined
							}
						>
							<Check className="h-2.5 w-2.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-5 w-5"
							onClick={() => setArmed(false)}
							disabled={pending}
							aria-label={t("common.cancel")}
						>
							<Cross className="h-2.5 w-2.5" />
						</Button>
					</span>
					{dialogs}
				</>
			)
		}
		return (
			<>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={() => void handleDelete()}
					disabled={disabled || pending}
					data-testid={testId !== undefined ? `${testId}-confirm` : undefined}
				>
					{pending ? t("deleteEntity.deleting") : t("deleteEntity.confirm")}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => setArmed(false)}
					disabled={pending}
				>
					{t("common.cancel")}
				</Button>
				{dialogs}
			</>
		)
	}

	if (compactIcon) {
		return (
			<>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="h-5 w-5 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
					onClick={handleInitialClick}
					disabled={disabled}
					aria-label={t("deleteEntity.defaultLabel")}
					data-testid={testId}
				>
					<TrashBinMinimalistic className="h-2.5 w-2.5" />
				</Button>
				{dialogs}
			</>
		)
	}

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={handleInitialClick}
				disabled={disabled}
				data-testid={testId}
			>
				{t("deleteEntity.defaultLabel")}
			</Button>
			{dialogs}
		</>
	)
})

function extractDependencyReason(err: unknown): string | undefined {
	if (!isTRPCClientError(err)) return undefined
	const trpcErr: TRPCClientError<AppRouter> = err
	const domain = readDomainShape(trpcErr.data)
	if (domain === undefined) return undefined
	if (!domain.kind.endsWith(".has_dependencies")) return undefined
	return domain.message
}

type DomainShape = Readonly<{ kind: string; message: string }>

function readDomainShape(data: unknown): DomainShape | undefined {
	if (!isPlainObject(data)) return undefined
	const domain = data.domain
	if (!isPlainObject(domain)) return undefined
	const { kind, message } = domain
	if (typeof kind !== "string" || typeof message !== "string") return undefined
	return { kind, message }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

function getMessage(err: unknown): string {
	if (err instanceof Error) return err.message
	return ""
}
