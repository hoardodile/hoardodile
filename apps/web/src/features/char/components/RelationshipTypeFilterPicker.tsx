import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AddGridPill } from "@/components/common/AddGridPill"
import { DualChipList } from "@/components/common/DualChipList"
import { relationshipTypesQueryOptions } from "../api"
import { AddRelationshipTypeDialog } from "./AddRelationshipTypeDialog"
import { RelationshipKindIcon } from "./RelationshipKindBadge"

export type RelationshipTypeFilterPickerProps = {
	readonly value: readonly string[]
	readonly onChange: (ids: readonly string[]) => void
}

/**
 * Relationship-type facet (the Relations DualChipList): selected types
 * sit in the Selected block, the rest in the Available cloud, both
 * rendered with their kind icon. The trailing dashed pill quick-creates
 * a type definition, which then appears in the cloud.
 */
export function RelationshipTypeFilterPicker(
	props: RelationshipTypeFilterPickerProps,
) {
	const { value, onChange } = props
	const { t } = useTranslation()
	const typesQ = useQuery(relationshipTypesQueryOptions())
	const types = typesQ.data ?? []
	const selected = new Set(value)
	const [addOpen, setAddOpen] = useState(false)

	function toggleType(typeId: string) {
		if (selected.has(typeId)) {
			onChange(value.filter((id) => id !== typeId))
			return
		}
		onChange([...value, typeId])
	}

	return (
		<div data-testid="character-relationship-filter">
			{types.length > 0 ? (
				<DualChipList
					items={types.map((type) => ({
						id: type.id,
						label: type.name,
						// Inline: the preflight block display would break the
						// chip's text line around the icon.
						icon: (
							<RelationshipKindIcon
								kind={type.kind}
								className="inline size-3"
							/>
						),
						color: type.color,
						selected: selected.has(type.id),
					}))}
					size="md"
					onToggle={toggleType}
				/>
			) : null}
			<AddGridPill
				label={t("me.custom.entity.relation")}
				onClick={() => setAddOpen(true)}
				className="mt-1.5"
				testId="relation-filter-add"
			/>
			<AddRelationshipTypeDialog open={addOpen} onOpenChange={setAddOpen} />
		</div>
	)
}
