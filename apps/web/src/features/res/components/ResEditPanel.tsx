import type { Resource } from "@hoardodile/schemas"
import {
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
	MAX_SOURCE_NAME_LENGTH,
	MAX_URL_LENGTH,
} from "@hoardodile/schemas"
import {
	DialogFooterActions,
	useDialogFooterActions,
} from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@hoardodile/ui/components/form"
import { Input } from "@hoardodile/ui/components/input"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { toast } from "@hoardodile/ui/components/toast"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useMemo } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
	pluginListAllQueryOptions,
	resolveManifestName,
} from "@/features/plugin"
import { useToastMutation } from "@/hooks/useToastMutation"
import { errorMessage } from "@/lib/errors"
import {
	invalidateResources,
	setResourceContentPluginIdMutation,
	updateResourceMutation,
} from "../api"
import { SOURCE_NAME_DATALIST_ID, SourceNameSuggest } from "./SourceNameSuggest"

type FormValues = {
	readonly name: string
	readonly intro: string
	readonly sourceName: string
	readonly sourceUrl: string
	readonly contentPluginId: string
}

export type ResEditPanelProps = {
	readonly resource: Resource
	readonly onSaved?: () => void
}

/**
 * Edit basic information (name and intro) plus content type for a
 * resource. Tags are edited separately via the tag panel.
 */
export function ResEditPanel(props: ResEditPanelProps) {
	const { resource, onSaved } = props
	const qc = useQueryClient()
	const { t, i18n } = useTranslation()
	const footerSlot = useDialogFooterActions()
	// The dialog footer's submit button targets this form via its id, so
	// Enter-to-submit semantics survive the move out of the body.
	const formId = useId()
	const schema = useMemo(
		() =>
			z.object({
				name: z
					.string()
					.min(1, t("resources.editPanel.nameRequired"))
					.max(MAX_NAME_LENGTH),
				intro: z.string().max(MAX_INTRO_LENGTH),
				sourceName: z.string().max(MAX_SOURCE_NAME_LENGTH),
				sourceUrl: z.string().max(MAX_URL_LENGTH),
				contentPluginId: z.string().min(1),
			}),
		[t],
	)
	const form = useForm<FormValues>({
		resolver: standardSchemaResolver(schema),
		defaultValues: {
			name: resource.name,
			intro: resource.intro,
			sourceName: resource.sourceName ?? "",
			sourceUrl: resource.sourceUrl ?? "",
			contentPluginId: resource.contentPluginId ?? "",
		},
	})

	const pluginListQuery = useQuery(pluginListAllQueryOptions())
	const list = pluginListQuery.data ?? []
	const knownIds = new Set(list.map((p) => p.id))
	// A resource whose plugin id the server has never seen (uninstalled
	// without a settings record) would otherwise render a blank trigger —
	// surface it as an explicit "missing" option instead. The residual id
	// is a long UUID that would blow out the two-column field width, so
	// render it truncated with the full id discoverable via title.
	const unknownCurrent =
		resource.contentPluginId !== null && !knownIds.has(resource.contentPluginId)
			? [
					{
						value: resource.contentPluginId,
						label: (
							<span
								title={resource.contentPluginId}
								className="inline-flex min-w-0 align-baseline"
							>
								{t("plugins.missing")} ·{" "}
								{shortPluginId(resource.contentPluginId)}
							</span>
						),
					},
				]
			: []
	const pluginOptions = [
		...unknownCurrent,
		...list.map((p) => ({
			value: p.id,
			label:
				resolveManifestName(p.manifest, i18n.language) +
				(p.missing ? ` (${t("plugins.missing")})` : ""),
		})),
	]

	const updateMut = useToastMutation({
		...updateResourceMutation(),
		invalidate: (qc) => invalidateResources(qc, resource.id),
		successToastKey: "common.saved",
		errorToastKey: "common.saveFailed",
		onSuccess: onSaved,
	})

	const setContentPluginIdMut = useMutation({
		...setResourceContentPluginIdMutation(),
		onSuccess: async (result) => {
			if (result.ok) {
				await invalidateResources(qc, resource.id)
			}
		},
	})

	async function handleSubmit(values: FormValues) {
		if (values.contentPluginId !== resource.contentPluginId) {
			try {
				const result = await setContentPluginIdMut.mutateAsync({
					id: resource.id,
					contentPluginId: values.contentPluginId,
				})
				if (!result.ok) {
					form.setError("contentPluginId", {
						message: t("resources.editDialog.contentTypeMissing", {
							names: result.failure.reasons.join(", "),
						}),
					})
					return
				}
			} catch (err) {
				toast.add({
					title: errorMessage(
						err,
						t("resources.editDialog.toast.contentTypeFailed"),
					),
					type: "error",
				})
				return
			}
		}
		updateMut.mutate({
			id: resource.id,
			name: values.name,
			intro: values.intro,
			// Empty strings clear the source fields server-side.
			sourceName: values.sourceName.trim(),
			sourceUrl: values.sourceUrl.trim(),
		})
	}

	const submitButton = (
		<Button
			type="submit"
			form={formId}
			disabled={updateMut.isPending || setContentPluginIdMut.isPending}
			data-testid="edit-submit"
		>
			{updateMut.isPending || setContentPluginIdMut.isPending
				? t("common.saving")
				: t("resources.editDialog.saveChanges")}
		</Button>
	)

	return (
		<Form {...form}>
			<form
				id={formId}
				onSubmit={form.handleSubmit(handleSubmit)}
				className="flex flex-col gap-3.5"
				aria-label={t("resources.editDialog.aria")}
			>
				<FormField
					control={form.control}
					name="name"
					render={({ field }) => (
						<FormItem className="gap-1.5">
							<FormLabel className="text-xs font-normal text-muted-foreground">
								{t("resources.editDialog.name")}
							</FormLabel>
							<FormControl>
								<Input
									{...field}
									data-testid="edit-name"
									placeholder={t("resources.editDialog.namePlaceholder")}
									autoComplete="off"
									maxLength={MAX_NAME_LENGTH}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="intro"
					render={({ field }) => (
						<FormItem className="gap-1.5">
							<FormLabel className="text-xs font-normal text-muted-foreground">
								{t("resources.editDialog.intro")}
							</FormLabel>
							<FormControl>
								<Textarea
									{...field}
									rows={3}
									data-testid="edit-intro"
									placeholder={t("resources.editDialog.introPlaceholder")}
									autoComplete="off"
									maxLength={MAX_INTRO_LENGTH}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<div className="grid grid-cols-2 gap-3">
					<FormField
						control={form.control}
						name="contentPluginId"
						render={({ field }) => (
							<FormItem className="gap-1.5">
								<FormLabel className="text-xs font-normal text-muted-foreground">
									{t("resources.editDialog.plugin")}
								</FormLabel>
								<FormControl>
									<DropdownSelect
										value={field.value ?? ""}
										onValueChange={field.onChange}
										data-testid="edit-content-type"
										options={pluginOptions}
										triggerClassName="w-full justify-between"
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="sourceName"
						render={({ field }) => (
							<FormItem className="gap-1.5">
								<FormLabel className="text-xs font-normal text-muted-foreground">
									{t("resources.editDialog.sourceName")}
								</FormLabel>
								<FormControl>
									<Input
										{...field}
										data-testid="edit-source-name"
										placeholder={t(
											"resources.editDialog.sourceNamePlaceholder",
										)}
										autoComplete="off"
										list={SOURCE_NAME_DATALIST_ID}
										maxLength={MAX_SOURCE_NAME_LENGTH}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>
				<SourceNameSuggest />
				<FormField
					control={form.control}
					name="sourceUrl"
					render={({ field }) => (
						<FormItem className="gap-1.5">
							<FormLabel className="text-xs font-normal text-muted-foreground">
								{t("resources.editDialog.sourceUrl")}
							</FormLabel>
							<FormControl>
								<Input
									{...field}
									data-testid="edit-source-url"
									placeholder={t("resources.editDialog.sourceUrlPlaceholder")}
									autoComplete="off"
									maxLength={MAX_URL_LENGTH}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<p className="text-xs text-muted-foreground">
					{t("resources.editDialog.sourceHint")}
				</p>
				{footerSlot === null ? (
					<div className="flex justify-end pt-2">{submitButton}</div>
				) : null}
			</form>
			{footerSlot !== null ? (
				<DialogFooterActions>{submitButton}</DialogFooterActions>
			) : null}
		</Form>
	)
}

/** Render a long plugin id compactly for the "missing" options — a UUID
    would otherwise overflow the selector — keeping the full id discoverable
    via the element's title. */
function shortPluginId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}…` : id
}
