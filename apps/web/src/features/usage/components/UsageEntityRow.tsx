import type { UsageEntityType } from "@hoardodile/schemas"
import { useQuery } from "@tanstack/react-query"
import { CharChip, charDetailCardQueryOptions } from "@/features/char"
import { docNodeViewQueryOptions } from "@/features/doc"
import { pluginListAllQueryOptions } from "@/features/plugin"
import { resDetailCardQueryOptions } from "@/features/res"

export function entityDetailHref(
	entityType: UsageEntityType,
	entityId: string,
): string | undefined {
	switch (entityType) {
		case "resource":
			return `/resources/${entityId}`
		case "character":
			return `/characters/${entityId}`
		case "document":
			return `/documents/${entityId}`
		case "plugin":
			return undefined
	}
}

export function useUsageEntityName(
	entityType: UsageEntityType,
	entityId: string,
): { name: string | undefined; isPending: boolean } {
	const resourceQuery = useQuery({
		...resDetailCardQueryOptions(entityId),
		enabled: entityType === "resource",
	})
	const characterQuery = useQuery({
		...charDetailCardQueryOptions(entityId),
		enabled: entityType === "character",
	})
	const documentQuery = useQuery({
		...docNodeViewQueryOptions(entityId),
		enabled: entityType === "document",
	})
	const pluginsQuery = useQuery({
		...pluginListAllQueryOptions(),
		enabled: entityType === "plugin",
	})

	switch (entityType) {
		case "resource":
			return {
				name: resourceQuery.data?.name,
				isPending: resourceQuery.isPending,
			}
		case "character":
			return {
				name: characterQuery.data?.name,
				isPending: characterQuery.isPending,
			}
		case "document":
			return {
				name: documentQuery.data?.node.title,
				isPending: documentQuery.isPending,
			}
		case "plugin": {
			const plugin = pluginsQuery.data?.find((p) => p.id === entityId)
			return {
				name: plugin?.manifest.name,
				isPending: pluginsQuery.isPending,
			}
		}
	}
}

export function useUsageEntityCharacter(entityId: string, enabled: boolean) {
	return useQuery({
		...charDetailCardQueryOptions(entityId),
		enabled,
		select: (data) =>
			data !== undefined
				? { name: data.name, updatedAt: data.updatedAt }
				: undefined,
	})
}

export function UsageEntityLeaderboardLabel(props: {
	readonly entityType: UsageEntityType
	readonly entityId: string
}) {
	const { entityType, entityId } = props
	const { name } = useUsageEntityName(entityType, entityId)
	const characterQuery = useUsageEntityCharacter(
		entityId,
		entityType === "character",
	)

	if (entityType === "character") {
		return (
			<CharChip
				charId={entityId}
				character={characterQuery.data}
				showName
				disableLink
			/>
		)
	}

	return (
		<span className="min-w-0 truncate font-medium text-foreground">
			{name ?? entityId}
		</span>
	)
}
