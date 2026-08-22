import { PageHeader } from "@hoardodile/ui/components/page-header"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { FolderImporter } from "@/features/res"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/resources/import")({
	beforeLoad: requireAuth,
	component: ResourceImportRoute,
})

/**
 * Folder import — its own page, reached from the resources index header.
 * Bulk import is a different job than a staged upload, so it gets its own
 * place. Reuses the shared {@link FolderImporter}.
 */
function ResourceImportRoute() {
	const { t } = useTranslation()
	return (
		<PageScaffold width="reading">
			<PageHeader
				title={t("resources.import.title")}
				description={t("resources.import.description")}
			/>
			<FolderImporter />
		</PageScaffold>
	)
}
