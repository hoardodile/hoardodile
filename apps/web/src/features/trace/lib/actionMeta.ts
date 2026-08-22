import {
	ChatRoundDots,
	ChatRoundLine,
	Dislike,
	DocumentAdd,
	Download,
	Eraser,
	FileRemove,
	Like,
	PenNewRound,
	Repeat,
	TrashBinMinimalistic,
	UndoLeftRound,
	UndoRightRound,
	Upload,
	UserMinus,
	UserPlus,
} from "@hoardodile/ui/icons/registry"
import type { ComponentType } from "react"
import type { RouterOutputs } from "@/trpc/client"

export type TraceAction =
	RouterOutputs["trace"]["timeline"]["rows"][number]["action"]

export type TraceEvent = RouterOutputs["trace"]["timeline"]["rows"][number]

/** The four entity groups the timeline filters by. */
export type TraceEntityType = "resource" | "comment" | "document" | "character"

export type TraceVoteKind = "like" | "dislike"

type TraceActionMeta = {
	/** Full sentence label, interpolates the entity name. */
	readonly labelKey: string
	/** Short label for the filter tabs. */
	readonly filterKey: string
	readonly icon: ComponentType<{ className?: string }>
}

export const TRACE_ACTION_META: Record<TraceAction, TraceActionMeta> = {
	"resource.import": {
		labelKey: "trace.actions.import",
		filterKey: "trace.filters.import",
		icon: Download,
	},
	"resource.export": {
		labelKey: "trace.actions.export",
		filterKey: "trace.filters.export",
		icon: Upload,
	},
	"resource.softDelete": {
		labelKey: "trace.actions.softDelete",
		filterKey: "trace.filters.softDelete",
		icon: TrashBinMinimalistic,
	},
	"resource.restore": {
		labelKey: "trace.actions.restore",
		filterKey: "trace.filters.restore",
		icon: UndoRightRound,
	},
	"resource.hardDelete": {
		labelKey: "trace.actions.hardDelete",
		filterKey: "trace.filters.hardDelete",
		icon: Eraser,
	},
	"resource.dislike.add": {
		labelKey: "trace.actions.dislikeAdd",
		filterKey: "trace.filters.dislikeAdd",
		icon: Dislike,
	},
	"resource.dislike.cancel": {
		labelKey: "trace.actions.dislikeCancel",
		filterKey: "trace.filters.dislikeCancel",
		icon: UndoLeftRound,
	},
	"comment.create": {
		labelKey: "trace.actions.messageCreate",
		filterKey: "trace.filters.messageCreate",
		icon: ChatRoundLine,
	},
	"comment.softDelete": {
		labelKey: "trace.actions.messageSoftDelete",
		filterKey: "trace.filters.messageSoftDelete",
		icon: ChatRoundDots,
	},
	"comment.restore": {
		labelKey: "trace.actions.messageRestore",
		filterKey: "trace.filters.messageRestore",
		icon: UndoRightRound,
	},
	"comment.hardDelete": {
		labelKey: "trace.actions.messageHardDelete",
		filterKey: "trace.filters.messageHardDelete",
		icon: Eraser,
	},
	"comment.vote.add": {
		labelKey: "trace.actions.messageVoteAddLike",
		filterKey: "trace.filters.messageVoteAdd",
		icon: Like,
	},
	"comment.vote.cancel": {
		labelKey: "trace.actions.messageVoteCancelLike",
		filterKey: "trace.filters.messageVoteCancel",
		icon: UndoLeftRound,
	},
	"comment.vote.swap": {
		labelKey: "trace.actions.messageVoteSwapLike",
		filterKey: "trace.filters.messageVoteSwap",
		icon: Repeat,
	},
	"document.create": {
		labelKey: "trace.actions.documentCreate",
		filterKey: "trace.filters.documentCreate",
		icon: DocumentAdd,
	},
	"document.commit": {
		labelKey: "trace.actions.documentCommit",
		filterKey: "trace.filters.documentCommit",
		icon: PenNewRound,
	},
	"document.softDelete": {
		labelKey: "trace.actions.documentSoftDelete",
		filterKey: "trace.filters.documentSoftDelete",
		icon: FileRemove,
	},
	"document.restore": {
		labelKey: "trace.actions.documentRestore",
		filterKey: "trace.filters.documentRestore",
		icon: UndoRightRound,
	},
	"document.hardDelete": {
		labelKey: "trace.actions.documentHardDelete",
		filterKey: "trace.filters.documentHardDelete",
		icon: Eraser,
	},
	"character.create": {
		labelKey: "trace.actions.characterCreate",
		filterKey: "trace.filters.characterCreate",
		icon: UserPlus,
	},
	"character.softDelete": {
		labelKey: "trace.actions.characterSoftDelete",
		filterKey: "trace.filters.characterSoftDelete",
		icon: UserMinus,
	},
	"character.restore": {
		labelKey: "trace.actions.characterRestore",
		filterKey: "trace.filters.characterRestore",
		icon: UndoRightRound,
	},
	"character.hardDelete": {
		labelKey: "trace.actions.characterHardDelete",
		filterKey: "trace.filters.characterHardDelete",
		icon: Eraser,
	},
}

/**
 * The timeline's filter tabs — the four entity groups actions live under
 * (`entityType`), never the fine-grained verbs each group folds.
 */
export const TRACE_ENTITY_GROUPS: readonly {
	readonly value: TraceEntityType
	readonly labelKey: string
}[] = [
	{ value: "resource", labelKey: "trace.filters.group.resource" },
	{ value: "comment", labelKey: "trace.filters.group.messages" },
	{ value: "document", labelKey: "trace.filters.group.document" },
	{ value: "character", labelKey: "trace.filters.group.character" },
]

export function traceEventIcon(
	action: TraceAction,
	kind?: TraceVoteKind,
): ComponentType<{ className?: string }> {
	if (action === "comment.vote.add") {
		return kind === "dislike" ? Dislike : Like
	}
	return TRACE_ACTION_META[action].icon
}

/**
 * Label key for an event row. Vote actions split on the vote kind recorded
 * in `detail` (like vs dislike carry different verbs and icons).
 */
export function traceEventLabelKey(
	action: TraceAction,
	kind?: TraceVoteKind,
): string {
	switch (action) {
		case "comment.vote.add":
			return kind === "dislike"
				? "trace.actions.messageVoteAddDislike"
				: "trace.actions.messageVoteAddLike"
		case "comment.vote.cancel":
			return kind === "dislike"
				? "trace.actions.messageVoteCancelDislike"
				: "trace.actions.messageVoteCancelLike"
		case "comment.vote.swap":
			return kind === "dislike"
				? "trace.actions.messageVoteSwapDislike"
				: "trace.actions.messageVoteSwapLike"
		default:
			return TRACE_ACTION_META[action].labelKey
	}
}
