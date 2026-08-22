import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@hoardodile/ui/components/empty"
import { Icon } from "@hoardodile/ui/components/icon"
import { Magnifier } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"

export function SearchEmptyState() {
	const { t } = useTranslation()
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon icon={Magnifier} className="size-6" />
				</EmptyMedia>
				<EmptyTitle>{t("search.empty.title")}</EmptyTitle>
				<EmptyDescription>{t("search.empty.description")}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	)
}
