import type { PluginPermissions } from "@hoardodile/sdk-types"
import { useTranslation } from "react-i18next"

const PERMISSION_KEYS = [
	"sourceMeta",
	"searchMeta",
	"danmaku",
	"message",
	"imageHashes",
	"container",
] as const satisfies readonly (keyof PluginPermissions)[]

/**
 * The manifest permissions a plugin actually declared, in stable order.
 * Mostly host-integration feature flags; `container` is additionally
 * enforced by the sandbox (listContainer/extractArchive gate).
 */
export function grantedPermissionKeys(
	permissions: PluginPermissions,
): readonly (keyof PluginPermissions)[] {
	return PERMISSION_KEYS.filter((key) => permissions[key] === true)
}

/**
 * Small read-only badges listing a plugin's declared permissions.
 * Rendered in the install confirmation dialog and in the plugin list.
 */
export function PluginPermissionBadges(props: {
	readonly permissions: PluginPermissions
	readonly className?: string
}) {
	const { t } = useTranslation()
	const granted = grantedPermissionKeys(props.permissions)
	if (granted.length === 0) return null
	return (
		<div className={`flex flex-wrap gap-1.5 ${props.className ?? ""}`}>
			{granted.map((key) => (
				<span
					key={key}
					className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
				>
					{t(`plugins.permissions.${key}`)}
				</span>
			))}
		</div>
	)
}
