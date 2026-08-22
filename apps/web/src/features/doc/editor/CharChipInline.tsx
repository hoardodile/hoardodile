import { createReactInlineContentSpec } from "@blocknote/react"
import { useQuery } from "@tanstack/react-query"
import { charDetailQueryOptions } from "@/features/char/api"
import { CharChip } from "@/features/char/components/CharChip"

/**
 * Inline `charChip`: an inline character mention.
 *
 * Stored shape carries only the character id; name/avatar are resolved
 * live from the character detail query so chips stay in sync when
 * characters are renamed or have their avatar swapped. Visual layout
 * is delegated to the shared {@link CharChip} component so chips
 * inside documents look identical to chips elsewhere in the app.
 */
export const charChipInlineSpec = createReactInlineContentSpec(
	{
		type: "charChip",
		propSchema: {
			charId: { default: "" },
			fallbackName: { default: "" },
		},
		content: "none",
	},
	{
		render: (props) => {
			const id = props.inlineContent.props.charId
			const fallback = props.inlineContent.props.fallbackName
			return <CharChipView charId={id} fallback={fallback} />
		},
		toExternalHTML: (props) => {
			const id = props.inlineContent.props.charId
			const fallback = props.inlineContent.props.fallbackName
			return <CharChipExternal charId={id} fallback={fallback} />
		},
	},
)

type CharChipViewProps = {
	readonly charId: string
	readonly fallback: string
}

function CharChipView(props: CharChipViewProps) {
	const enabled = props.charId.length > 0
	const query = useQuery({
		...charDetailQueryOptions(props.charId),
		enabled,
	})
	const character = query.data
	// Wrapping in a contentEditable=false span prevents the editor from
	// stealing focus when users click the chip.
	return (
		<span contentEditable={false} className="align-middle" data-character-chip>
			<CharChip
				charId={props.charId}
				character={
					character !== undefined
						? { name: character.name, updatedAt: character.updatedAt }
						: props.fallback.length > 0
							? { name: props.fallback, updatedAt: 0 }
							: undefined
				}
				showName
			/>
		</span>
	)
}

/**
 * Minimal external-HTML renderer for `charChip`. BlockNote uses this
 * when copying to clipboard or exporting — only the character name
 * is rendered so pasting into external editors produces clean text
 * without avatar URLs, title attributes, or duplicate names.
 */
function CharChipExternal(props: CharChipViewProps) {
	const enabled = props.charId.length > 0
	const query = useQuery({
		...charDetailQueryOptions(props.charId),
		enabled,
	})
	const name = query.data?.name ?? props.fallback ?? props.charId
	return <span>{name}</span>
}
