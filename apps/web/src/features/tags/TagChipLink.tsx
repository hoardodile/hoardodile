import { TagChip, type TagChipSize } from "@hoardodile/ui/components/tag-chip"
import { cn } from "@hoardodile/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { forwardRef, type ReactNode } from "react"

export type TagChipLinkProps = {
	readonly id: string
	/** Label inside the chip; may be a string or rich content. */
	readonly name: ReactNode
	/** Effective display color; empty string means "no color override". */
	readonly color: string
	/** Dot-separated trailing suffix (see {@link TagChip} `suffix`). */
	readonly suffix?: ReactNode
	/** Chip height tier — see {@link TagChipSize}. */
	readonly size?: TagChipSize
	/**
	 * When `false`, render as a plain inline chip without navigating to
	 * the tag-filtered resource list. Defaults to `true` (link mode).
	 */
	readonly link?: boolean
	/** Rule-carried tag: rendered weakened (it cannot be removed directly). */
	readonly virtual?: boolean
	readonly type: "resource" | "character"
	readonly className?: string
}

/**
 * {@link TagChip} as a navigation link: single pinned-tag chip with
 * subtle hover treatment, navigating to `/resources?tagIds=…` or
 * `/characters?tagIds=…` when clicked. The chip itself is the anchor
 * (the `render` slot) — no wrapping link, so the hit area is exactly
 * the chip. Virtual (rule-carried) tags render weakened.
 *
 * Forwards the chip's ref so hover-card triggers can anchor to the
 * anchor element.
 */
export const TagChipLink = forwardRef<HTMLElement, TagChipLinkProps>(
	function TagChipLink(props, ref) {
		const {
			id,
			name,
			color,
			suffix,
			size,
			link = true,
			virtual,
			type,
			className,
		} = props
		const chipClass = cn(className, virtual && "opacity-60")

		if (!link) {
			return (
				<TagChip
					color={color}
					suffix={suffix}
					size={size}
					ref={ref}
					className={chipClass}
				>
					{name}
				</TagChip>
			)
		}

		return (
			<TagChip
				color={color}
				suffix={suffix}
				size={size}
				ref={ref}
				className={chipClass}
				render={
					<Link
						to={type === "resource" ? "/resources" : "/characters"}
						search={{ tagIds: [id], page: 1 }}
					/>
				}
			>
				{name}
			</TagChip>
		)
	},
)
