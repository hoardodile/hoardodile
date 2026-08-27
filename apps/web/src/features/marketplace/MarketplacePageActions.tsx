import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { toast } from "@hoardodile/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { errorMessage } from "@/lib/errors"
import { marketRepoUrl } from "./MarketplaceDetailDialog"
import {
	marketplaceConfigQueryOptions,
	marketplaceKeys,
	marketplaceSetConfigMutation,
} from "./marketplaceApi"

/**
 * Page-level registry actions — the same slot as the plugins page's
 * upload/rescan bar: one primary button plus a quiet hint, sitting
 * OUTSIDE the settings section. The registry address itself is edited
 * in a dialog, mirroring how the plugins page keeps its page actions
 * above the sections.
 */
export function MarketplacePageActions() {
	const { t } = useTranslation()
	const configQuery = useQuery(marketplaceConfigQueryOptions())
	const registryRepo = configQuery.data?.registryRepo ?? null
	const [open, setOpen] = useState(false)

	return (
		<>
			<div className="mb-3 flex items-center justify-start gap-2">
				<Button
					onClick={() => setOpen(true)}
					data-testid="marketplace-registry-config"
				>
					{t("marketplace.configureRegistry")}
				</Button>
			</div>
			<p className="mb-3 -mt-2 text-tiny text-muted-foreground">
				{t("marketplace.pageHint")}
			</p>
			<MarketplaceRegistryDialog
				open={open}
				registryRepo={registryRepo}
				onOpenChange={setOpen}
			/>
		</>
	)
}

/** Registry repo address — one labeled field behind a page-level dialog. */
function MarketplaceRegistryDialog(props: {
	readonly open: boolean
	readonly registryRepo: string | null
	readonly onOpenChange: (open: boolean) => void
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const [value, setValue] = useState("")
	const saveMut = useMutation({
		...marketplaceSetConfigMutation(),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: marketplaceKeys.config() })
			void qc.invalidateQueries({ queryKey: marketplaceKeys.snapshot() })
			toast.add({
				title: t("marketplace.saved", { repo: value }),
				type: "success",
			})
			props.onOpenChange(false)
		},
		onError: (err) => {
			toast.add({
				title: errorMessage(err, t("common.error")),
				type: "error",
			})
		},
	})

	return (
		<AppDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			title={t("marketplace.registryDialogTitle")}
			description={t("marketplace.setupHint")}
			footer={
				<>
					<Button variant="secondary" onClick={() => props.onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={() => saveMut.mutate({ registryRepo: value })}
						disabled={value.length === 0 || saveMut.isPending}
						data-testid="marketplace-registry-save"
					>
						{t("marketplace.save")}
					</Button>
				</>
			}
		>
			<label className="flex flex-col gap-1 pb-1">
				<span className="text-xs font-medium">
					{t("marketplace.registryRepoLabel")}
				</span>
				<input
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={
						props.registryRepo !== null
							? marketRepoUrl(props.registryRepo)
							: t("marketplace.registryPlaceholder")
					}
					className="h-9 min-w-0 self-stretch rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					data-testid="marketplace-registry-input"
				/>
			</label>
		</AppDialog>
	)
}
