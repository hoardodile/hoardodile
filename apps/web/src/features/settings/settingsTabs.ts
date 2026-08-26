import type { IconType } from "@hoardodile/ui/components/icon"
import {
	Archive,
	Database,
	InfoCircle,
	PlugCircle,
	RefreshCircle,
	ShieldCheck,
	Shop2,
	SliderHorizontal,
	Star,
	WindowFrame,
} from "@hoardodile/ui/icons/registry"

export type SettingsTabKey =
	| "preferences"
	| "data"
	| "about"
	| "desktop"
	| "custom"
	| "privacy"
	| "archive"
	| "plugins"
	| "marketplace"
	| "sync"

export type SettingsTab = {
	readonly key: SettingsTabKey
	readonly path:
		| "/settings"
		| "/settings/data"
		| "/settings/about"
		| "/settings/desktop"
		| "/settings/custom"
		| "/settings/privacy"
		| "/settings/backups"
		| "/settings/plugins"
		| "/settings/marketplace"
		| "/settings/sync"
	readonly icon: IconType
	readonly testId: string
	/** Desktop-shell-only tab; hidden in a normal browser tab. */
	readonly desktopOnly?: boolean
}

export const SETTINGS_TABS: readonly SettingsTab[] = [
	{
		key: "preferences",
		path: "/settings",
		icon: SliderHorizontal,
		testId: "me-tab-preferences",
	},
	{
		key: "data",
		path: "/settings/data",
		icon: Database,
		testId: "me-tab-data",
	},
	{
		key: "about",
		path: "/settings/about",
		icon: InfoCircle,
		testId: "me-tab-about",
	},
	{
		key: "desktop",
		path: "/settings/desktop",
		icon: WindowFrame,
		testId: "me-tab-desktop",
		desktopOnly: true,
	},
	{
		key: "custom",
		path: "/settings/custom",
		icon: Star,
		testId: "me-tab-custom",
	},
	{
		key: "privacy",
		path: "/settings/privacy",
		icon: ShieldCheck,
		testId: "me-tab-privacy",
	},
	{
		key: "archive",
		path: "/settings/backups",
		icon: Archive,
		testId: "me-tab-archive",
	},
	{
		key: "plugins",
		path: "/settings/plugins",
		icon: PlugCircle,
		testId: "me-tab-plugins",
	},
	{
		key: "marketplace",
		path: "/settings/marketplace",
		icon: Shop2,
		testId: "me-tab-marketplace",
	},
	{
		key: "sync",
		path: "/settings/sync",
		icon: RefreshCircle,
		testId: "me-tab-sync",
	},
]

/** Tabs for the current platform — desktop-only entries drop out in a browser. */
export function visibleSettingsTabs(
	isDesktop: boolean,
): readonly SettingsTab[] {
	return SETTINGS_TABS.filter((tab) => !tab.desktopOnly || isDesktop)
}
