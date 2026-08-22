import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { cn } from "@hoardodile/ui/lib/utils"
import { useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { useClaimPanelSlot } from "@/components/layout/panelSlot"
import {
	DocHeadingNav,
	type HeadingInfo,
} from "@/features/doc/components/DocHeadingNav"

export type DocSidePanelProps = {
	readonly headings: readonly HeadingInfo[]
	readonly onNavigate: (blockId: string) => void
	readonly className?: string
}

/**
 * Right-hand panel of the document detail page. At `panel:` it portals
 * into the AppShell column (a sibling of `<main>`, so the page scrollbar
 * stays on the canvas); below that it is the body of the heading-nav
 * drawer. Tab bar: 12px uppercase labels with a 2px underline on the
 * active tab over a 2px strong bottom edge. CONTENTS hosts the heading
 * outline. The Notes tab is omitted until that feature lands.
 */
export function DocSidePanel(props: DocSidePanelProps) {
	const { t } = useTranslation()
	const [tab, setTab] = useState("contents")
	return (
		<SectionTabs
			value={tab}
			onChange={setTab}
			className={cn("h-full min-h-0 gap-0 overflow-hidden", props.className)}
			listClassName="mt-3.5 ml-2 desktop-shell:mt-0.5"
			items={[
				{
					value: "contents",
					label: t("documents.headings"),
					panelClassName: "min-h-0 flex-1 overflow-y-auto px-2 py-3",
					panel: (
						<DocHeadingNav
							headings={props.headings}
							onNavigate={props.onNavigate}
						/>
					),
				},
			]}
		/>
	)
}

/** Claims the shell panel column and portals {@link DocSidePanel} into it. */
export function DocSidePanelSlot(props: Omit<DocSidePanelProps, "className">) {
	const slot = useClaimPanelSlot()
	if (slot === null) return null
	return createPortal(<DocSidePanel {...props} />, slot)
}
