import type { RelationshipKind } from "@hoardodile/schemas"
import {
	ArrowRight,
	Structure,
	TransferHorizontal,
} from "@hoardodile/ui/icons/registry"

type Props = {
	readonly kind: RelationshipKind
	readonly className?: string
}

/**
 * Relationship kind → leading glyph: direction reads from the icon, not
 * a text qualifier; "mutual" and "symmetric" are the same concept (the
 * schema carries symmetric).
 */
export function RelationshipKindIcon(props: Props) {
	const { kind, className } = props
	if (kind === "symmetric") {
		return <TransferHorizontal className={className} aria-hidden />
	}
	if (kind === "hierarchical") {
		return <Structure className={className} aria-hidden />
	}
	return <ArrowRight className={className} aria-hidden />
}
