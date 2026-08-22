import type { Character } from "@hoardodile/schemas"
import {
	MAX_CHARACTER_INTRO_LENGTH,
	MAX_NAME_LENGTH,
} from "@hoardodile/schemas"
import {
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@hoardodile/ui/components/form"
import { Input } from "@hoardodile/ui/components/input"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { EntityEditPanel } from "@/components/common/EntityEditPanel"
import { invalidateCharacters, updateCharacterMutation } from "../api"

const schema = z.object({
	name: z.string().min(1, "Name is required").max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_CHARACTER_INTRO_LENGTH),
})

type FormValues = z.infer<typeof schema>

export type CharEditPanelProps = {
	readonly character: Character
	readonly onSaved?: () => void
}

export function CharEditPanel(props: CharEditPanelProps) {
	const { character, onSaved } = props
	const qc = useQueryClient()
	const { t } = useTranslation()
	return (
		<EntityEditPanel
			ariaLabel={t("characters.editDialog.aria")}
			schema={schema}
			defaults={{ name: character.name, intro: character.intro }}
			mutation={updateCharacterMutation()}
			buildInput={(values: FormValues) => ({ id: character.id, ...values })}
			invalidate={() => invalidateCharacters(qc, character.id)}
			onSaved={onSaved}
		>
			{(form) => (
				<>
					<FormField
						control={form.control}
						name="name"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("characters.editDialog.name")}</FormLabel>
								<FormControl>
									<Input
										{...field}
										data-testid="edit-name"
										placeholder={t("characters.create.namePlaceholder")}
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
							<FormItem>
								<FormLabel>{t("characters.editDialog.intro")}</FormLabel>
								<FormControl>
									<Textarea
										{...field}
										data-testid="edit-intro"
										placeholder={t("characters.create.introPlaceholder")}
										autoComplete="off"
										maxLength={MAX_CHARACTER_INTRO_LENGTH}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</>
			)}
		</EntityEditPanel>
	)
}
