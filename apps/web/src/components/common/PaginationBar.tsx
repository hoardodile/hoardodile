import {
	PaginationBar as PaginationBarShell,
	type PaginationBarProps as PaginationBarShellProps,
} from "@hoardodile/ui/components/pagination-bar"
import { useTranslation } from "react-i18next"

export type PaginationBarProps = Omit<PaginationBarShellProps, "labels"> & {
	/** Localized chrome labels — defaults to the common pager labels. */
	labels?: Partial<PaginationBarShellProps["labels"]>
}

/**
 * The app-wired {@link PaginationBar} shell: the localized pager chrome
 * (prev/next aria labels, go-to field labels) lives here, everything
 * else passes through to `@hoardodile/ui/components/pagination-bar`.
 */
export function PaginationBar(props: PaginationBarProps) {
	const { labels, ...rest } = props
	const { t } = useTranslation()
	return (
		<PaginationBarShell
			{...rest}
			labels={{
				prev: labels?.prev ?? t("common.prev"),
				next: labels?.next ?? t("common.next"),
				goTo: labels?.goTo ?? t("common.goTo"),
				jumpToPage: labels?.jumpToPage ?? t("common.jumpToPage"),
			}}
		/>
	)
}
