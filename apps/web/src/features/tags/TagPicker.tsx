import type { Tag } from "@hoardodile/schemas"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { Label } from "@hoardodile/ui/components/label"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import {
	attachToCharacterMutation,
	attachToResourceMutation,
	detachFromCharacterMutation,
	detachFromResourceMutation,
	tagKeys,
	tagsForCharacterQueryOptions,
	tagsForResourceQueryOptions,
} from "./api"
import { useTagList } from "./store"

type EntityKind = "resource" | "character"

export type TagPickerProps = {
	readonly entityId: string
	readonly entityKind: EntityKind
}

export function TagPicker(props: TagPickerProps) {
	const { entityId, entityKind } = props
	const { t } = useTranslation()

	const allTags = useTagList()
	// Each conditional query is enabled only for its matching kind.
	const forResourceQuery = useQuery({
		...tagsForResourceQueryOptions(entityId),
		enabled: entityKind === "resource",
	})
	const forCharacterQuery = useQuery({
		...tagsForCharacterQueryOptions(entityId),
		enabled: entityKind === "character",
	})

	const entityTagData: readonly Tag[] =
		entityKind === "resource"
			? (forResourceQuery.data ?? [])
			: (forCharacterQuery.data ?? [])

	const entityTagIds = new Set(entityTagData.map((td) => td.id))

	const invalidateKey = invalidateKeyFor(entityKind, entityId)

	const attachMut = useToastMutation({
		...attachMutationFor(entityKind),
		invalidate: (qc) => qc.invalidateQueries({ queryKey: invalidateKey }),
		errorToastKey: "tags.toast.attachFailed",
	})

	const detachMut = useToastMutation({
		...detachMutationFor(entityKind),
		invalidate: (qc) => qc.invalidateQueries({ queryKey: invalidateKey }),
		errorToastKey: "tags.toast.detachFailed",
	})

	function handleToggle(tagId: string, checked: boolean) {
		if (checked) {
			attachMut.mutate({ entityId, tagId })
		} else {
			detachMut.mutate({ entityId, tagId })
		}
	}

	if (allTags.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("tags.picker.emptyAll")}
			</p>
		)
	}

	return (
		<div className="flex flex-col gap-2" data-testid="tag-picker">
			{allTags.map((tag) => {
				const checked = entityTagIds.has(tag.id)
				return (
					<div key={tag.id} className="flex items-center gap-2">
						<Checkbox
							id={`tag-${tag.id}`}
							checked={checked}
							onCheckedChange={(v) => handleToggle(tag.id, v === true)}
							data-testid={`tag-checkbox-${tag.name}`}
						/>
						<Label htmlFor={`tag-${tag.id}`} className="text-sm">
							{tag.name}
						</Label>
					</div>
				)
			})}
		</div>
	)
}

function attachMutationFor(kind: EntityKind) {
	if (kind === "resource") return attachToResourceMutation()
	return attachToCharacterMutation()
}

function detachMutationFor(kind: EntityKind) {
	if (kind === "resource") return detachFromResourceMutation()
	return detachFromCharacterMutation()
}

function invalidateKeyFor(kind: EntityKind, entityId: string) {
	if (kind === "resource") return tagKeys.forResource(entityId)
	return tagKeys.forCharacter(entityId)
}
