import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { More } from "@hoardodile/ui/icons/actions"
import { AltArrowDown, AltArrowRight } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

/** One row of the rules tree — a tag (or character) rendered as a chip,
    with a trailing More menu. Children nest under it like document tree
    rows. */
export type RulesTreeBranch = {
	readonly id: string
	/** The row's leading content — a TagChip or CharChip. */
	readonly chip: ReactNode
	/** Text the search filter matches (tag name / character name). */
	readonly searchText: string
	readonly testId?: string
	readonly expandTestId?: string
	readonly moreTestId?: string
	/** Items of the row's More dropdown. */
	readonly menuItems: ReactNode
	readonly children: readonly RulesTreeBranch[]
}

export type RulesTreeProps = {
	readonly nodes: readonly RulesTreeBranch[]
	/** The set of expanded ids; absent ids render collapsed. */
	readonly expandedIds: ReadonlySet<string>
	readonly onToggleExpanded: (id: string) => void
	/** Non-empty: filter to matching rows (with their ancestors) and
	    render everything expanded. */
	readonly query: string
	readonly noMatchTestId?: string
}

/** Keep nodes whose own text or any descendant matches; a parent stays
    only as the ancestor chain of a match. */
function filterTree(
	nodes: readonly RulesTreeBranch[],
	query: string,
): readonly RulesTreeBranch[] {
	const q = query.trim().toLowerCase()
	if (q.length === 0) return nodes
	const result: RulesTreeBranch[] = []
	for (const node of nodes) {
		const children = filterTree(node.children, q)
		if (children.length > 0 || node.searchText.toLowerCase().includes(q)) {
			result.push({ ...node, children })
		}
	}
	return result
}

/**
 * The tag rules' display — the two zones (aliases, parents) as the same
 * tree the document sidebar uses: `h-nav` rows that tint on hover, a
 * chevron per branch (all collapsed by default, expandable), the tag or
 * character chip as the row's content, and one hover-revealed More
 * button carrying every row action — no per-chip button groups.
 * Searching narrows the tree to matching rows plus their ancestors and
 * forces everything open, so a match is never buried in a collapsed
 * branch.
 */
export function RulesTree(props: RulesTreeProps) {
	const { nodes, expandedIds, onToggleExpanded, query, noMatchTestId } = props
	const { t } = useTranslation()
	const searching = query.trim().length > 0
	const visible = searching ? filterTree(nodes, query) : nodes

	if (visible.length === 0) {
		return (
			<p
				className="px-1 py-2 text-xs text-muted-foreground"
				data-testid={noMatchTestId}
			>
				{t("tags.rules.noMatch")}
			</p>
		)
	}

	return (
		<div>
			{visible.map((branch) => (
				<RulesRow
					key={branch.id}
					branch={branch}
					depth={0}
					expandedIds={expandedIds}
					onToggleExpanded={onToggleExpanded}
					searching={searching}
				/>
			))}
		</div>
	)
}

function RulesRow(props: {
	readonly branch: RulesTreeBranch
	readonly depth: number
	readonly expandedIds: ReadonlySet<string>
	readonly onToggleExpanded: (id: string) => void
	readonly searching: boolean
}) {
	const { branch, depth, expandedIds, onToggleExpanded, searching } = props
	const { t } = useTranslation()
	const hasChildren = branch.children.length > 0
	const expanded = searching || expandedIds.has(branch.id)

	return (
		<div>
			{/* The row: chevron, the chip, then the hover-revealed More
			    button. Indented by depth exactly like document rows. */}
			<div
				className="group relative flex h-nav items-center gap-2 rounded-lg pr-1 text-secondary-foreground transition-colors duration-150 hover:bg-muted"
				style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}
				data-testid={branch.testId}
			>
				<button
					type="button"
					className={cn(
						"flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
						!hasChildren && "pointer-events-none opacity-0",
					)}
					onClick={() => onToggleExpanded(branch.id)}
					aria-label={expanded ? t("common.collapse") : t("common.expand")}
					data-testid={branch.expandTestId}
				>
					{expanded ? (
						<AltArrowDown className="size-4" strokeWidth={1.6} />
					) : (
						<AltArrowRight className="size-4" strokeWidth={1.6} />
					)}
				</button>
				<span className="flex min-w-0 flex-1 items-center">{branch.chip}</span>
				<div className="flex shrink-0 items-center opacity-100 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									className="size-5 rounded-full text-muted-foreground/50 transition-colors hover:bg-transparent hover:text-foreground"
									aria-label={t("me.custom.more")}
									data-testid={branch.moreTestId}
								>
									<More className="size-4" strokeWidth={1.6} />
								</Button>
							}
						/>
						<DropdownMenuContent align="end">
							{branch.menuItems}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			{hasChildren && expanded ? (
				// Collapsed branches are unmounted to keep deep chains
				// responsive — mirroring the document tree.
				<div className="grid grid-rows-[1fr]">
					<div className="min-h-0 overflow-hidden">
						{branch.children.map((child) => (
							<RulesRow
								key={child.id}
								branch={child}
								depth={depth + 1}
								expandedIds={expandedIds}
								onToggleExpanded={onToggleExpanded}
								searching={searching}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	)
}
