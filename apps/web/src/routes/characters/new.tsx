import {
	MAX_CHARACTER_INTRO_LENGTH,
	MAX_NAME_LENGTH,
} from "@hoardodile/schemas"

import { Button } from "@hoardodile/ui/components/button"
import { FixedActionBar } from "@hoardodile/ui/components/fixed-action-bar"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@hoardodile/ui/components/form"
import { ImageCropPanel } from "@hoardodile/ui/components/image-crop-panel"
import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { PageHeader } from "@hoardodile/ui/components/page-header"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { toast } from "@hoardodile/ui/components/toast"
import { Gallery, Link as LinkIcon, User } from "@hoardodile/ui/icons/registry"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { createCharacterMutation, invalidateCharacters } from "@/features/char"
import { uploadCharImage } from "@/features/char/api"
import { TraitValueEditor } from "@/features/char/components/TraitValueEditor"
import { UploadSection } from "@/features/res/upload/UploadSection"
import { traitListQueryOptions } from "@/features/traits"
import { errorMessage } from "@/lib/errors"
import { mimeToImageExt } from "@/lib/mime"

const schema = z.object({
	name: z.string().max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_CHARACTER_INTRO_LENGTH),
})

type FormValues = z.infer<typeof schema>

export const Route = createFileRoute("/characters/new")({
	component: NewCharacterRoute,
})

function NewCharacterRoute() {
	const qc = useQueryClient()
	const navigate = useNavigate()
	const { t } = useTranslation()
	const [tagIds, setTagIds] = useState<readonly string[]>([])
	const [traitDraft, setTraitDraft] = useState<Record<string, string>>({})
	const [avatarCrop, setAvatarCrop] = useState<CroppedImage | undefined>(
		undefined,
	)
	const [fullbodyCrop, setFullbodyCrop] = useState<CroppedImage | undefined>(
		undefined,
	)

	const traitsQ = useQuery(traitListQueryOptions())
	const traits = traitsQ.data ?? []

	const form = useForm<FormValues>({
		resolver: standardSchemaResolver(schema),
		defaultValues: { name: "", intro: "" },
	})

	const nameValue = useWatch({ control: form.control, name: "name" })
	const nameEmpty = nameValue.trim().length === 0

	const createMut = useMutation({
		...createCharacterMutation(),
	})

	async function onSubmit(values: FormValues) {
		const trimmedName = values.name.trim()
		if (trimmedName.length === 0) return
		const traitValues: Record<string, string> = {}
		for (const [k, v] of Object.entries(traitDraft)) {
			const trimmed = v.trim()
			if (trimmed.length > 0) traitValues[k] = trimmed
		}

		try {
			const character = await createMut.mutateAsync({
				name: trimmedName,
				intro: values.intro.length > 0 ? values.intro : undefined,
				tagIds,
				traitValues:
					Object.keys(traitValues).length > 0 ? traitValues : undefined,
			})

			const uploads: Promise<unknown>[] = []
			if (avatarCrop !== undefined) {
				const ext = mimeToImageExt(avatarCrop.mimeType)
				uploads.push(
					uploadCharImage(
						character.id,
						"avatar",
						avatarCrop.blob,
						`avatar${ext}`,
					),
				)
			}
			if (fullbodyCrop !== undefined) {
				const ext = mimeToImageExt(fullbodyCrop.mimeType)
				uploads.push(
					uploadCharImage(
						character.id,
						"fullbody",
						fullbodyCrop.blob,
						`fullbody${ext}`,
					),
				)
			}
			if (uploads.length > 0) {
				await Promise.all(uploads)
			}

			await invalidateCharacters(qc)
			toast.add({ title: t("characters.toast.createSuccess"), type: "success" })
			await navigate({
				to: "/characters/$id",
				params: { id: character.id },
			})
		} catch (err: unknown) {
			toast.add({
				title: errorMessage(err, t("characters.toast.createFailed")),
				type: "error",
			})
		}
	}

	return (
		<PageScaffold width="content" bottomPad={false}>
			<PageHeader
				title={t("characters.create.title")}
				description={t("characters.create.description")}
				className="mb-0"
			/>
			<Form {...form}>
				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-6 pb-24"
				>
					<div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_var(--spacing-panel)]">
						<div className="flex min-w-0 flex-col gap-6">
							<UploadSection
								icon={User}
								title={t("characters.create.basicInfo")}
								description={t("characters.create.basicDescription")}
								data-testid="create-character-basic-section"
							>
								<div className="flex flex-col">
									<FormField
										control={form.control}
										name="name"
										render={({ field }) => (
											<FormItem className="flex flex-col gap-0">
												<FormLabel className="text-xs font-normal text-secondary-foreground">
													{t("characters.create.name")}
												</FormLabel>
												<FormControl>
													<Input
														{...field}
														size="lg"
														className="mt-1.5"
														data-testid="create-character-name"
														autoComplete="off"
														placeholder={t("characters.create.namePlaceholder")}
														maxLength={MAX_NAME_LENGTH}
													/>
												</FormControl>
												<p className="mt-1.5 text-tiny text-muted-foreground">
													{t("characters.create.nameHint")}
												</p>
												<FormMessage className="mt-1.5" />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="intro"
										render={({ field }) => (
											<FormItem className="mt-4 flex flex-col gap-0">
												<FormLabel className="text-xs font-normal text-secondary-foreground">
													{t("characters.create.intro")}
												</FormLabel>
												<FormControl>
													<Textarea
														{...field}
														data-testid="create-character-intro"
														rows={4}
														placeholder={t(
															"characters.create.introPlaceholder",
														)}
														className="mt-1.5 min-h-[100px]"
														maxLength={MAX_CHARACTER_INTRO_LENGTH}
													/>
												</FormControl>
												<FormMessage className="mt-1.5" />
											</FormItem>
										)}
									/>
								</div>
							</UploadSection>

							<UploadSection
								icon={LinkIcon}
								title={t("characters.create.links")}
								description={t("characters.create.linksDescription")}
								data-testid="create-character-links-section"
							>
								<div className="flex flex-col">
									<div className="mt-4 flex flex-col first:mt-0">
										<Label className="text-xs font-normal text-secondary-foreground">
											{t("characters.create.tags")}
										</Label>
										<div className="mt-1.5" data-testid="create-character-tags">
											<DualTagPicker
												value={tagIds}
												onChange={setTagIds}
												kind="character"
											/>
										</div>
									</div>

									<div className="mt-4 flex flex-col">
										<Label className="text-xs font-normal text-secondary-foreground">
											{t("characters.create.traits")}
										</Label>
										<div className="mt-1.5">
											<TraitValueEditor
												traits={traits}
												values={traitDraft}
												onChange={setTraitDraft}
											/>
										</div>
									</div>
								</div>
							</UploadSection>
						</div>

						<UploadSection
							icon={Gallery}
							title={t("characters.create.appearance")}
							description={t("characters.create.appearanceDescription")}
							data-testid="create-character-appearance-section"
						>
							<div>
								<div className="mb-2 text-xs text-secondary-foreground">
									{t("characters.create.avatar")}
								</div>
								<ImageCropPanel
									aspect={1}
									previewShape="circle"
									cropStageWidth={200}
									cropStageHeight={200}
									hideActionButton
									autoSaveOnCrop
									hidePreview
									fillWidth
									onSave={async (cropped) => {
										setAvatarCrop(cropped)
									}}
								/>
							</div>

							<div className="mt-4">
								<div className="mb-2 text-xs text-secondary-foreground">
									{t("characters.create.fullbody")}
								</div>
								<ImageCropPanel
									previewShape="square"
									cropStageWidth={260}
									cropStageHeight={500}
									hideActionButton
									autoSaveOnCrop
									hidePreview
									fillWidth
									onSave={async (cropped) => {
										setFullbodyCrop(cropped)
									}}
								/>
							</div>
						</UploadSection>
					</div>

					<FixedActionBar>
						<Button
							type="submit"
							data-testid="create-character-submit"
							disabled={createMut.isPending || nameEmpty}
						>
							{createMut.isPending
								? t("characters.create.submitting")
								: t("characters.create.submit")}
						</Button>
					</FixedActionBar>
				</form>
			</Form>
		</PageScaffold>
	)
}
