import type { ResCard as ResCardData } from "@hoardodile/schemas"
import { Link } from "@tanstack/react-router"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { formatBytes } from "@/lib/formatBytes"
import { ResThumb } from "./ResThumb"

export type ResourceRowProps = {
	readonly resource: ResCardData
	/** Cache-buster for the cover thumb (the resource's `updatedAt`). */
	readonly cacheKey?: number | string
}

/**
 * Compact horizontal resource row: a 56px cover thumb, a truncated name,
 * and a muted file-size · date meta line. Used for collection siblings
 * in the detail panel.
 */
export function ResourceRow(props: ResourceRowProps) {
	const { resource, cacheKey } = props
	const { formatDateTime } = useDateFormatter()
	const size = resource.fileStats?.sizeBytes
	return (
		<Link
			to="/resources/$id"
			params={{ id: resource.id }}
			className="group flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"
		>
			<div className="size-14 shrink-0 overflow-hidden rounded-lg">
				<ResThumb
					resId={resource.id}
					cacheKey={cacheKey}
					className="size-full"
					fill
				/>
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-ui font-medium text-foreground">
					{resource.name}
				</div>
				<div className="mt-0.5 text-tiny text-muted-foreground">
					{size !== undefined ? formatBytes(size) : ""}
					{size !== undefined ? " · " : ""}
					{formatDateTime(resource.createdAt)}
				</div>
			</div>
		</Link>
	)
}
