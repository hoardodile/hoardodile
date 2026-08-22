import { MAX_RELATIONSHIP_TYPE_NAME_LENGTH } from "@hoardodile/schemas"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { EntityMetaFields } from "@/components/common/EntityMetaFields"
import type { RelationshipTypeFormDraft } from "./RelationshipTypeFormFields"
import { RelationshipTypeVisualEditor } from "./RelationshipTypeVisualEditor"

type Props = {
	readonly draft: RelationshipTypeFormDraft
	readonly onChange: (patch: Partial<RelationshipTypeFormDraft>) => void
	readonly nameTestId?: string
	readonly metaTestIdPrefix?: string
}

export function RelationshipTypeDialogBody(props: Props) {
	const { draft, onChange, nameTestId, metaTestIdPrefix } = props
	const { t } = useTranslation()
	const [tab, setTab] = useState("details")

	return (
		<SectionTabs
			value={tab}
			onChange={setTab}
			className="w-full"
			items={[
				{
					value: "details",
					label: t("relationshipTypes.panel.tabDetails"),
					testId: "relationship-type-tab-details",
					panelClassName: "pt-4",
					panel: (
						<EntityMetaFields
							value={draft}
							onChange={onChange}
							maxNameLength={MAX_RELATIONSHIP_TYPE_NAME_LENGTH}
							testIdPrefix={metaTestIdPrefix}
							nameTestId={nameTestId}
						/>
					),
				},
				{
					value: "definition",
					label: t("relationshipTypes.panel.tabDefinition"),
					testId: "relationship-type-tab-definition",
					panelClassName: "pt-4",
					panel: (
						<RelationshipTypeVisualEditor draft={draft} onChange={onChange} />
					),
				},
			]}
		/>
	)
}
