import type { CatKind, Tag } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@hoardodile/ui/components/dropdown-menu"
import { Icon } from "@hoardodile/ui/components/icon"
import { ListEmptyRow } from "@hoardodile/ui/components/list-empty-row"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Add } from "@hoardodile/ui/icons/actions"
import { Crown, TrashBinMinimalistic } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import type { TFunction } from "i18next"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { SearchField } from "@/components/common/SearchField"
import {
	catListWithCountsQueryOptions,
	invalidateCategories,
} from "@/features/cat"
import { CATEGORY_KIND_TABS, isCategoryKind } from "@/features/cat/panelModel"
import { invalidateCharacters, useCharactersByIds } from "@/features/char"
import { CharChip } from "@/features/char/components/CharChip"
import { invalidateResources } from "@/features/res/api"
import { useToastMutation } from "@/hooks/useToastMutation"
import {
	invalidateTags,
	parentRuleCreateMutation,
	parentRuleRemoveMutation,
	parentRulesQueryOptions,
	siblingGroupsQueryOptions,
	siblingRuleCreateMutation,
	siblingRuleRemoveMutation,
	siblingSetDisplayMutation,
	type TagParentRule,
	type TagSiblingGroup,
	tagListWithCountsQueryOptions,
} from "./api"
import { tagErrorMessage } from "./errors"
import { RuleAddDialog } from "./RuleAddDialog"
import { RulesTree, type RulesTreeBranch } from "./RulesTree"
import { TagChip } from "./TagChip"

/**
 * Tag rules management (M2 + M3) — the Tags tab's second block: two
 * zones whose top rows carry a single Add button opening the big editor
 * dialog. Both zones render as the document tree's own anatomy — `h-nav`
 * rows that tint on hover, a chevron per branch (collapsed by default),
 * the tag / character chip as the row's content, and one hover-revealed
 * More button carrying every row action — with a filter field above each
 * tree and a height-capped scroll area, so a library's worth of rules
 * stays navigable. Aliases: the display tag is the root row (the crowned
 * chip), its aliases are leaf rows — a group never nests members under
 * members. Parents: a real tree, children nest under their parent to any
 * depth; a node's More offers Add child (opening the dialog with the
 * parent slot preset at the node) and Delete. Character members ride
 * along as character chips
 * with their own remove menu.
 */
export function TagRulesSection() {
	const { t } = useTranslation()
	const catsQ = useQuery(catListWithCountsQueryOptions())
	const tagsQ = useQuery(tagListWithCountsQueryOptions())
	const groupsQ = useQuery(siblingGroupsQueryOptions())
	const [kind, setKind] = useState<CatKind>("common")
	const [aliasDialogOpen, setAliasDialogOpen] = useState(false)
	const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
	/** Presets for the editor dialogs when opened from a row's More menu. */
	const [aliasPresetTagId, setAliasPresetTagId] = useState<string | undefined>(
		undefined,
	)
	const [rulePresetParentId, setRulePresetParentId] = useState<
		string | undefined
	>(undefined)
	const [aliasQuery, setAliasQuery] = useState("")
	const [parentQuery, setParentQuery] = useState("")
	// All-collapsed by default, like the document tree; the searches
	// force everything open while a query is active.
	const [aliasExpanded, setAliasExpanded] = useState<ReadonlySet<string>>(
		() => new Set(),
	)
	const [parentExpanded, setParentExpanded] = useState<ReadonlySet<string>>(
		() => new Set(),
	)

	const tags = tagsQ.data ?? []
	const cats = catsQ.data ?? []
	const groups = groupsQ.data ?? []
	const tagsById = useMemo(
		() => new Map(tags.map((tag) => [tag.id, tag])),
		[tags],
	)
	const kindOfTag = useMemo(() => {
		const catKind = new Map(cats.map((c) => [c.id, c.kind]))
		return (tagId: string) =>
			catKind.get(tagsById.get(tagId)?.catId ?? "") ?? "common"
	}, [cats, tagsById])

	// Groups follow their members' kinds: a group shows on a tab when any
	// member tag's kind matches, and on the character tab when it carries
	// character members (mirroring parent rules, where a character child
	// surfaces on the character tab and its parent's tab).
	const kindGroups = groups.filter(
		(g) =>
			g.memberTagIds.some((id) => kindOfTag(id) === kind) ||
			(kind === "character" && g.memberCharacters.length > 0),
	)
	const parentRulesQ = useQuery(parentRulesQueryOptions())
	const parentRules = parentRulesQ.data ?? []

	// Rules involving the active kind, with `common` as an allowed partner:
	// the tab shows everything it could add from its own pickers. A
	// character child counts as `character` kind, so its rule shows on the
	// character tab and on the tab of its parent tag (mirroring sibling
	// groups, whose character members ride along on the display tag's tab).
	const kindParentRules = parentRules.filter((rule) => {
		const kinds = new Set<string>([kindOfTag(rule.parentId)])
		if (rule.childKind === "character") kinds.add("character")
		else kinds.add(kindOfTag(rule.childId))
		return kinds.has(kind)
	})

	// Character names for parent-rule rows (group cards carry their own).
	const ruleCharIds = useMemo(
		() => [
			...new Set(
				kindParentRules
					.filter((r) => r.childKind === "character")
					.map((r) => r.childId),
			),
		],
		[kindParentRules],
	)
	const { data: ruleChars } = useCharactersByIds(ruleCharIds)
	const ruleCharsById = useMemo(
		() => new Map((ruleChars ?? []).map((c) => [c.id, c])),
		[ruleChars],
	)

	const parentTree = useMemo(
		() => buildParentTree(kindParentRules, tagsById),
		[kindParentRules, tagsById],
	)

	const invalidateAll = useToastInvalidate()

	const createMut = useToastMutation({
		...siblingRuleCreateMutation(),
		invalidate: invalidateAll,
		onSuccess: (_data, input) => {
			setAliasDialogOpen(false)
			// Reveal the display row the pair landed on.
			setAliasExpanded((cur) => withExpanded(cur, [input.goodId]))
		},
		successToastKey: "tags.rules.toast.pairAdded",
		resolveError: tagErrorMessage,
	})

	const removeMut = useToastMutation({
		...siblingRuleRemoveMutation(),
		invalidate: invalidateAll,
		successToastKey: "tags.rules.toast.pairRemoved",
		resolveError: tagErrorMessage,
	})

	const displayMut = useToastMutation({
		...siblingSetDisplayMutation(),
		invalidate: invalidateAll,
		successToastKey: "tags.rules.toast.displaySet",
		resolveError: tagErrorMessage,
	})

	const parentCreateMut = useToastMutation({
		...parentRuleCreateMutation(),
		invalidate: invalidateAll,
		onSuccess: (_data, input) => {
			setRuleDialogOpen(false)
			// Reveal the parent chain the rule landed under.
			setParentExpanded((cur) =>
				withExpanded(cur, ancestorIds(input.parentId, parentRules)),
			)
		},
		successToastKey: "tags.rules.toast.parentAdded",
		resolveError: tagErrorMessage,
	})

	const parentRemoveMut = useToastMutation({
		...parentRuleRemoveMutation(),
		invalidate: invalidateAll,
		successToastKey: "tags.rules.toast.parentRemoved",
		resolveError: tagErrorMessage,
	})

	const pairPending = displayMut.isPending || removeMut.isPending
	const aliasTree = aliasBranches(kindGroups, tagsById, {
		onAddAlias: (displayTagId) => {
			setAliasPresetTagId(displayTagId)
			setAliasDialogOpen(true)
		},
		onSetDisplay: (tagId) => displayMut.mutate({ id: tagId }),
		onRemoveMember: (badKind, badId) => removeMut.mutate({ badKind, badId }),
		pending: pairPending,
		t,
	})
	const parentTreeBranches = parentBranches(parentTree, ruleCharsById, {
		onAddChild: (parentId) => {
			setRulePresetParentId(parentId)
			setRuleDialogOpen(true)
		},
		onRemove: (input) => parentRemoveMut.mutate(input),
		pending: parentRemoveMut.isPending,
		t,
	})

	const allowCharacters = kind === "character" || kind === "common"

	return (
		<div className="flex flex-col gap-6">
			{/* Rules follow the active kind tab, like the categories panel. */}
			<PillTabs
				value={kind}
				onChange={(next) => {
					if (isCategoryKind(next)) setKind(next)
				}}
				className="self-start"
				items={CATEGORY_KIND_TABS.map((k) => ({
					value: k,
					label: t(`categories.panel.kindTab.${k}`),
					testId: `tag-rules-kind-tab-${k}`,
				}))}
			/>

			{/* The two zones side by side on wide screens — the trees stay
			    narrower than the 800px content column; below `md` they
			    stack with the 2px seam between them. */}
			<div className="grid gap-6 md:grid-cols-2 md:items-start">
				{/* Aliases zone — tags that render as one. The display tag is
				    the tree's root row (the crowned chip); its aliases and
				    character links are leaf rows — a group never nests
				    deeper than one level. */}
				<section className="flex flex-col gap-2.5">
					{/* The zone's top row: the label and the single Add button
					    opening the editor dialog. */}
					<div className="flex flex-wrap items-center gap-3">
						<ZoneLabel
							title={t("tags.rules.aliasesTitle")}
							count={t("tags.rules.groupCount", {
								count: kindGroups.length,
							})}
						/>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setAliasDialogOpen(true)}
							data-testid="tag-rules-add-alias-button"
						>
							<Icon icon={Add} />
							{t("tags.rules.addAlias")}
						</Button>
					</div>

					{kindGroups.length === 0 ? (
						<ListEmptyRow testId="tag-rules-empty">
							{t("tags.rules.empty")}
						</ListEmptyRow>
					) : (
						<>
							{/* Filter above the tree — the rows match by name, the
						    matching tag's ancestor chain stays visible. */}
							<SearchField
								value={aliasQuery}
								onCommit={setAliasQuery}
								placeholder={t("tags.rules.searchPlaceholder")}
								className="h-8"
								testId="tag-rules-alias-search"
							/>
							<div className="max-h-72 overflow-y-auto pr-1">
								<RulesTree
									nodes={aliasTree}
									expandedIds={aliasExpanded}
									onToggleExpanded={(id) =>
										setAliasExpanded((cur) => withToggled(cur, id))
									}
									query={aliasQuery}
									noMatchTestId="tag-rules-alias-no-match"
								/>
							</div>
						</>
					)}

					{/* Characters only join rules on the character tab — the
				    picker's character section — so the explainer rides along
				    here instead of cluttering the other kinds. */}
					{kind === "character" ? (
						<p
							className="text-xs text-muted-foreground"
							data-testid="tag-rules-character-hint"
						>
							{t("tags.rules.characterLinkHint")}
						</p>
					) : null}
				</section>

				{/* Parents zone — below `md` the 2px seam parts the two rule
				    kinds; side by side the grid gap does. The tree is the
				    display; the top row's Add rule button opens the editor
				    dialog, and each node's More offers Add child (the dialog
				    with the parent slot preset at the node) and Delete. */}
				<section className="flex flex-col gap-2.5 border-t-2 border-border pt-5 md:border-t-0 md:pt-0">
					<div className="flex flex-wrap items-center gap-3">
						<ZoneLabel
							title={t("tags.rules.parentsTitle")}
							count={t("tags.rules.ruleCount", {
								count: kindParentRules.length,
							})}
						/>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setRuleDialogOpen(true)}
							data-testid="tag-rules-add-parent-button"
						>
							<Icon icon={Add} />
							{t("tags.rules.addRule")}
						</Button>
					</div>

					{kindParentRules.length === 0 ? (
						<ListEmptyRow testId="tag-rules-parents-empty">
							{t("tags.rules.parentsEmpty")}
						</ListEmptyRow>
					) : (
						<>
							<SearchField
								value={parentQuery}
								onCommit={setParentQuery}
								placeholder={t("tags.rules.searchPlaceholder")}
								className="h-8"
								testId="tag-rules-parent-search"
							/>
							<div className="max-h-72 overflow-y-auto pr-1">
								<RulesTree
									nodes={parentTreeBranches}
									expandedIds={parentExpanded}
									onToggleExpanded={(id) =>
										setParentExpanded((cur) => withToggled(cur, id))
									}
									query={parentQuery}
									noMatchTestId="tag-rules-parents-no-match"
								/>
							</div>
						</>
					)}
				</section>
			</div>

			{/* The two editors — one big dialog per zone, the embedded
			    pickers right in the body, no nested dialogs. They close
			    only on a successful save (the mutations' onSuccess). */}
			<RuleAddDialog
				open={aliasDialogOpen}
				onOpenChange={setAliasDialogOpen}
				title={t("tags.rules.addAlias")}
				description={t("tags.rules.addAliasDescription")}
				endpointLabel={t("tags.rules.badPlaceholder")}
				tagLabel={t("tags.rules.goodPlaceholder")}
				allowCharacters={allowCharacters}
				kind={kind}
				endpointTestId="tag-rules-synonym"
				tagTestId="tag-rules-good"
				tagPreset={aliasPresetTagId}
				confirmLabel={t("tags.rules.addAlias")}
				confirmTestId="tag-rules-alias-dialog-confirm"
				contentTestId="tag-rules-alias-dialog"
				pending={createMut.isPending}
				onConfirm={(endpoint, tagId) =>
					createMut.mutate({
						badKind: endpoint.kind,
						badId: endpoint.id,
						goodId: tagId,
					})
				}
			/>
			<RuleAddDialog
				open={ruleDialogOpen}
				onOpenChange={setRuleDialogOpen}
				title={t("tags.rules.addRule")}
				description={t("tags.rules.addRuleDescription")}
				endpointLabel={t("tags.rules.childPlaceholder")}
				tagLabel={t("tags.rules.parentPlaceholder")}
				allowCharacters={allowCharacters}
				kind={kind}
				endpointTestId="tag-rules-child"
				tagTestId="tag-rules-parent"
				tagPreset={rulePresetParentId}
				confirmLabel={t("tags.rules.addRule")}
				confirmTestId="tag-rules-rule-dialog-confirm"
				contentTestId="tag-rules-rule-dialog"
				pending={parentCreateMut.isPending}
				onConfirm={(endpoint, tagId) =>
					parentCreateMut.mutate({
						childKind: endpoint.kind,
						childId: endpoint.id,
						parentId: tagId,
					})
				}
			/>
		</div>
	)
}

// -- Trees --------------------------------------------------------------------

/** One alias group as a tree: the display tag is the root row, its
    member tags and character links are leaf rows — a group never nests
    members under members, so the tree stops at depth one. The root
    row's More offers Add alias (pointing the form's display slot at
    the group), a member's More the member actions. */
function aliasBranches(
	groups: readonly TagSiblingGroup[],
	tagsById: ReadonlyMap<string, Tag>,
	ctx: {
		readonly onAddAlias: (displayTagId: string) => void
		readonly onSetDisplay: (tagId: string) => void
		readonly onRemoveMember: (
			badKind: "tag" | "character",
			badId: string,
		) => void
		readonly pending: boolean
		readonly t: TFunction
	},
): RulesTreeBranch[] {
	const { onAddAlias, onSetDisplay, onRemoveMember, pending, t } = ctx
	return groups.map((group) => {
		const display = tagsById.get(group.displayTagId)
		const members = group.memberTagIds
			.map((id) => tagsById.get(id))
			.filter(
				(tag): tag is Tag => tag !== undefined && tag.id !== group.displayTagId,
			)
		return {
			id: group.displayTagId,
			searchText: display?.name ?? group.displayTagId,
			chip: (
				<TagChip
					color={display?.color ?? ""}
					border={display === undefined ? "dashed" : undefined}
					icon={<Icon icon={Crown} size="sm" aria-hidden />}
				>
					{display?.name ?? group.displayTagId}
				</TagChip>
			),
			testId: `tag-rules-display-${group.displayTagId}`,
			expandTestId: `tag-rules-alias-expand-${group.displayTagId}`,
			moreTestId: `tag-rules-display-more-${group.displayTagId}`,
			menuItems: (
				<DropdownMenuItem
					onClick={() => onAddAlias(group.displayTagId)}
					data-testid={`tag-rules-add-alias-${group.displayTagId}`}
				>
					<Icon icon={Add} />
					{t("tags.rules.alias")}
				</DropdownMenuItem>
			),
			children: [
				...members.map(
					(member): RulesTreeBranch => ({
						id: member.id,
						searchText: member.name,
						chip: <TagChip color={member.color}>{member.name}</TagChip>,
						testId: `tag-rules-member-${member.id}`,
						expandTestId: `tag-rules-alias-expand-${member.id}`,
						moreTestId: `tag-rules-member-more-${member.id}`,
						menuItems: (
							<>
								<DropdownMenuItem
									onClick={() => onSetDisplay(member.id)}
									disabled={pending}
									data-testid={`tag-rules-promote-${member.id}`}
								>
									<Icon icon={Crown} />
									{t("tags.rules.setDisplay")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onClick={() => onRemoveMember("tag", member.id)}
									disabled={pending}
									data-testid={`tag-rules-remove-${member.id}`}
								>
									<Icon icon={TrashBinMinimalistic} />
									{t("tags.rules.remove")}
								</DropdownMenuItem>
							</>
						),
						children: [],
					}),
				),
				...group.memberCharacters.map(
					(char): RulesTreeBranch => ({
						id: `character:${char.id}`,
						searchText: char.name,
						chip: <CharChip charId={char.id} character={char} showName />,
						testId: `tag-rules-char-member-${char.id}`,
						expandTestId: `tag-rules-alias-expand-character-${char.id}`,
						moreTestId: `tag-rules-char-member-more-${char.id}`,
						menuItems: (
							<DropdownMenuItem
								variant="destructive"
								onClick={() => onRemoveMember("character", char.id)}
								disabled={pending}
								data-testid={`tag-rules-char-remove-${char.id}`}
							>
								<Icon icon={TrashBinMinimalistic} />
								{t("tags.rules.remove")}
							</DropdownMenuItem>
						),
						children: [],
					}),
				),
			],
		}
	})
}

/** One node of the parent tree as a tree branch — the tag's row, then
    its child tags (recursing) and character children (leaf rows). */
function parentBranches(
	nodes: readonly ParentTreeNode[],
	ruleCharsById: ReadonlyMap<
		string,
		{ readonly id: string; readonly name: string; readonly updatedAt: number }
	>,
	ctx: {
		readonly onAddChild: (parentId: string) => void
		readonly onRemove: (input: {
			childKind: "tag" | "character"
			childId: string
			parentId: string
		}) => void
		readonly pending: boolean
		readonly t: TFunction
	},
): RulesTreeBranch[] {
	const { onAddChild, onRemove, pending, t } = ctx
	return nodes.map((node) => {
		const parentRule = node.parentRule
		const nodeTestId =
			parentRule !== undefined
				? `tag-rules-parent-${parentRule.childKind}-${parentRule.childId}-${parentRule.parentId}`
				: `tag-rules-tree-root-${node.id}`
		return {
			id: node.id,
			searchText: node.tag?.name ?? node.id,
			chip: (
				<TagChip
					color={node.tag?.color ?? ""}
					border={node.tag === undefined ? "dashed" : undefined}
				>
					{node.tag?.name ?? node.id}
				</TagChip>
			),
			testId: nodeTestId,
			expandTestId: `tag-rules-parent-expand-${node.id}`,
			moreTestId: `tag-rules-node-more-${node.id}`,
			menuItems: (
				<>
					<DropdownMenuItem
						onClick={() => onAddChild(node.id)}
						data-testid={`tag-rules-add-child-${node.id}`}
					>
						<Icon icon={Add} />
						{t("tags.rules.child")}
					</DropdownMenuItem>
					{parentRule !== undefined ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								onClick={() => onRemove(parentRule)}
								disabled={pending}
								data-testid={`tag-rules-parent-remove-${node.id}`}
							>
								<Icon icon={TrashBinMinimalistic} />
								{t("tags.rules.remove")}
							</DropdownMenuItem>
						</>
					) : null}
				</>
			),
			children: node.entries.map((entry) =>
				entry.kind === "tag"
					? parentBranches([entry.node], ruleCharsById, ctx)[0]!
					: {
							id: `character:${entry.rule.childId}:${entry.rule.parentId}`,
							searchText:
								ruleCharsById.get(entry.rule.childId)?.name ??
								entry.rule.childId,
							chip: (
								<CharChip
									charId={entry.rule.childId}
									character={ruleCharsById.get(entry.rule.childId)}
									showName
									className="max-w-40"
								/>
							),
							testId: `tag-rules-parent-character-${entry.rule.childId}-${entry.rule.parentId}`,
							expandTestId: `tag-rules-parent-expand-character-${entry.rule.childId}`,
							moreTestId: `tag-rules-parent-more-${entry.rule.childId}`,
							menuItems: (
								<DropdownMenuItem
									variant="destructive"
									onClick={() => onRemove(entry.rule)}
									disabled={pending}
									data-testid={`tag-rules-parent-remove-${entry.rule.childId}`}
								>
									<Icon icon={TrashBinMinimalistic} />
									{t("tags.rules.remove")}
								</DropdownMenuItem>
							),
							children: [],
						},
			),
		}
	})
}

// -- Parent tree model --------------------------------------------------------

/** A node of the parent tree — a tag plus the entries nested under it
    (child tags recurse, character children are leaf rows). */
type ParentTreeNode = {
	readonly id: string
	readonly tag: Tag | undefined
	/** The rule attaching this node to its parent; undefined for roots. */
	readonly parentRule: TagParentRule | undefined
	readonly entries: readonly ParentTreeEntry[]
}

type ParentTreeEntry =
	| { readonly kind: "tag"; readonly node: ParentTreeNode }
	| { readonly kind: "character"; readonly rule: TagParentRule }

/** One flat rule as the tree builder sees it — child kind + the rule. */
type ParentRuleEntry = {
	readonly kind: "tag" | "character"
	readonly rule: TagParentRule
}

/** Build the parent tree from the flat rules: each rule nests its child
    under the parent; tags that only appear as parents root the tree, and
    every parent keeps its children in rule order. */
function buildParentTree(
	rules: readonly TagParentRule[],
	tagsById: ReadonlyMap<string, Tag>,
): readonly ParentTreeNode[] {
	const childrenOf = new Map<string, ParentRuleEntry[]>()
	const childTagIds = new Set<string>()
	for (const rule of rules) {
		if (rule.childKind === "tag") childTagIds.add(rule.childId)
		const list = childrenOf.get(rule.parentId) ?? []
		list.push({ kind: rule.childKind, rule })
		childrenOf.set(rule.parentId, list)
	}
	function build(
		id: string,
		parentRule: TagParentRule | undefined,
	): ParentTreeNode {
		return {
			id,
			tag: tagsById.get(id),
			parentRule,
			entries: (childrenOf.get(id) ?? []).map((entry) =>
				entry.kind === "tag"
					? {
							kind: "tag",
							node: build(entry.rule.childId, entry.rule),
						}
					: { kind: "character", rule: entry.rule },
			),
		}
	}
	return [...childrenOf.keys()]
		.filter((id) => !childTagIds.has(id))
		.map((id) => build(id, undefined))
}

// -- Shared anatomy -----------------------------------------------------------

/** Section label row — uppercase muted title with the quiet count right
    beside it, then the zone's form pushed to the far end. */
function ZoneLabel(props: { readonly title: string; readonly count: string }) {
	return (
		<div className="flex min-w-0 flex-1 items-baseline gap-2">
			<SectionLabel tone="foreground">{props.title}</SectionLabel>
			<span className="text-tiny tabular-nums text-muted-foreground">
				{props.count}
			</span>
		</div>
	)
}

/** Toggle a row in the expanded set. */
function withToggled(
	value: ReadonlySet<string>,
	id: string,
): ReadonlySet<string> {
	const next = new Set(value)
	if (next.has(id)) next.delete(id)
	else next.add(id)
	return next
}

/** Add ids to the expanded set. */
function withExpanded(
	value: ReadonlySet<string>,
	ids: Iterable<string>,
): ReadonlySet<string> {
	return new Set([...value, ...ids])
}

/** The chain of ids from a parent up to the tree's top, in order. */
function ancestorIds(
	parentId: string,
	rules: readonly TagParentRule[],
): readonly string[] {
	const parentOf = new Map(rules.map((rule) => [rule.childId, rule.parentId]))
	const ids: string[] = [parentId]
	let current = parentId
	let hops = rules.length
	while (hops-- > 0) {
		const next = parentOf.get(current)
		if (next === undefined) break
		ids.push(next)
		current = next
	}
	return ids
}

function useToastInvalidate() {
	return async (qc: import("@tanstack/react-query").QueryClient) => {
		await invalidateTags(qc)
		await invalidateCategories(qc)
		await invalidateResources(qc)
		await invalidateCharacters(qc)
	}
}
