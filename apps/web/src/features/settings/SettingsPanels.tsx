import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Spinner } from "@hoardodile/ui/components/spinner"
import {
	Logout,
	TrashBinMinimalistic,
	User,
} from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { performSignOut } from "@/features/privacy/privacySignOut"
import { trashListQueryOptions } from "./api"
import { SettingsSection } from "./SettingsSection"
import { TrashPreviewDialog } from "./TrashPreviewDialog"
/**
 * Account section on the Preferences page: the single-user account
 * intro plus the sign-out action.
 */
export function SignOutSection() {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const { t } = useTranslation()
	const logoutMutation = useMutation({
		mutationFn: () => performSignOut(queryClient),
		onSuccess: async () => {
			await navigate({ to: "/login" })
		},
	})

	return (
		<SettingsSection
			icon={User}
			title={t("me.account.title")}
			description={t("me.account.description")}
			layout="compact"
			data-testid="sign-out-row"
		>
			<Button
				variant="secondary"
				onClick={() => logoutMutation.mutate()}
				disabled={logoutMutation.isPending}
				data-testid="sign-out"
			>
				<Icon icon={Logout} />
				{logoutMutation.isPending
					? t("overview.signingOut")
					: t("overview.signOut")}
			</Button>
		</SettingsSection>
	)
}

/**
 * Trash section on the App settings page showing count and a button to
 * open a full ResPreviewDialog-based flip-through preview.
 */
export function TrashPanel() {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const query = useQuery(trashListQueryOptions())
	const items = query.data?.items ?? []
	const loading = query.isPending

	function handleOpen() {
		if (items.length > 0) setOpen(true)
	}

	return (
		<div className="flex flex-wrap items-center gap-3">
			<Button
				variant="secondary"
				onClick={handleOpen}
				disabled={loading || items.length === 0}
				data-testid="view-trash"
			>
				{loading ? (
					<Spinner className="size-4" />
				) : (
					<Icon icon={TrashBinMinimalistic} />
				)}
				{loading
					? t("me.trash.loading")
					: t("me.trash.view", { count: items.length })}
			</Button>
			<TrashPreviewDialog items={items} open={open} onOpenChange={setOpen} />
		</div>
	)
}
