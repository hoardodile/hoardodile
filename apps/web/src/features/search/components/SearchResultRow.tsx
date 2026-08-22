import type { IconType } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import type { ReactNode } from "react"

/**
 * Search hit row — the hairline list anatomy shared by the documents and
 * messages result sections: 40px icon tile, title with optional kind pill,
 * 2-line clamped snippet, right-aligned tiny meta.
 */
export function SearchResultRow({
	icon,
	title,
	kind,
	snippet,
	meta,
	className,
}: {
	readonly icon: IconType
	readonly title: ReactNode
	/** Short kind label, e.g. "document", "folder" or "#12". */
	readonly kind?: string
	readonly snippet: ReactNode
	readonly meta: string
	readonly className?: string
}) {
	return (
		<div
			className={`flex gap-3 border-b border-border py-3 last:border-b-0 ${className ?? ""}`}
		>
			<IconTile icon={icon} size={40} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-ui font-medium text-foreground">
						{title}
					</span>
					{kind !== undefined ? <MetaChip>{kind}</MetaChip> : null}
				</div>
				<div className="mt-1 line-clamp-2 text-xs leading-[1.6] text-secondary-foreground">
					{snippet}
				</div>
			</div>
			<span className="flex-none pt-0.5 text-tiny text-muted-foreground">
				{meta}
			</span>
		</div>
	)
}
