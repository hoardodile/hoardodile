import { Link } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { TagChip } from "@/features/tags/TagChip"

/** Prepend `https://` when the user pasted a scheme-less address. */
export function withScheme(url: string): string {
	return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}

function hostnameOf(url: string): string | undefined {
	try {
		return new URL(withScheme(url)).hostname.replace(/^www\./, "")
	} catch {
		return undefined
	}
}

export type SourceChipProps = {
	readonly sourceName?: string
	readonly sourceUrl?: string
	readonly className?: string
}

/**
 * Provenance chip for a resource: renders the source name, falling back
 * to the link hostname (or a generic label) when only a URL is set.
 * Clickable when a URL exists — opens in a new tab, never fetched by the
 * app itself.
 */
export function SourceChip(props: SourceChipProps) {
	const { sourceName, sourceUrl, className } = props
	const { t } = useTranslation()
	if (sourceName === undefined && sourceUrl === undefined) return null
	const href = sourceUrl === undefined ? undefined : withScheme(sourceUrl)
	const label =
		sourceName ?? hostnameOf(sourceUrl ?? "") ?? t("resources.source.fallback")
	return (
		<TagChip
			color=""
			className={className}
			title={t("resources.source.aria", { name: label })}
			icon={
				href !== undefined ? (
					<Link className="size-3 shrink-0" aria-hidden />
				) : undefined
			}
			render={
				href !== undefined ? (
					<ExternalLink href={href} data-testid="source-chip-link">
						{label}
					</ExternalLink>
				) : undefined
			}
		>
			{label}
		</TagChip>
	)
}
