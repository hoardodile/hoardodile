import { Switch } from "@hoardodile/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { booleanCodec } from "@/features/prefs"
import { usePrefSync } from "@/hooks/usePrefSync"
import { prefKeys } from "@/lib/keys"

/** Query roots invalidated when the watch-only toggle flips. */
const WATCH_ONLY_INVALIDATE_ROOTS = [
	["character"] as const,
	["resource"] as const,
	["tag"] as const,
	["category"] as const,
]

/**
 * The global watch-only toggle. It is a server system preference (scope
 * `sync`) so the server's content-query layer can honour it directly;
 * flipping it here writes through the prefSync queue to
 * `systemPreference.set`, and the cached char/res/tag/category queries are
 * invalidated so every browse surface re-filters.
 */
export function WatchOnlyToggleRow() {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const [enabled, setEnabledState] = usePrefSync(
		prefKeys.watchOnly,
		false,
		booleanCodec(),
	)

	const setEnabled = useCallback(
		function setEnabled(next: boolean) {
			setEnabledState(next)
			for (const root of WATCH_ONLY_INVALIDATE_ROOTS) {
				queryClient.invalidateQueries({ queryKey: root })
			}
		},
		[queryClient, setEnabledState],
	)

	return (
		<div className="flex items-center justify-between gap-6">
			<div className="min-w-0">
				<div className="text-ui font-semibold text-foreground">
					{t("me.custom.watchOnly.title")}
				</div>
				<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
					{t("me.custom.watchOnly.description")}
				</p>
			</div>
			<Switch
				checked={enabled}
				onCheckedChange={setEnabled}
				aria-label={t("me.custom.watchOnly.title")}
				data-testid="watch-only-toggle"
			/>
		</div>
	)
}
