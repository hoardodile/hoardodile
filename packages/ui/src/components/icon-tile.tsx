import {
	Icon,
	type IconSize,
	type IconType,
} from "@hoardodile/ui/components/icon"
import { cn } from "@hoardodile/ui/lib/utils"

/**
 * 32/40px fill icon tile used by list rows and directory rows; the 40px
 * tier pairs with the lg icon.
 */
export function IconTile({
	icon,
	size = 32,
	iconSize,
	className,
}: {
	readonly icon: IconType
	readonly size?: 32 | 40
	/** Icon tier — md (16) by default, lg (20) on the 40px tile. */
	readonly iconSize?: IconSize
	readonly className?: string
}) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg bg-muted text-secondary-foreground",
				size === 40 ? "size-10" : "size-8",
				className,
			)}
		>
			<Icon icon={icon} size={iconSize ?? "md"} />
		</span>
	)
}
