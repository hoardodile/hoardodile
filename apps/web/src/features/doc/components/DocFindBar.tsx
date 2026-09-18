import { MAX_SEARCH_QUERY_LENGTH } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { Cross } from "@hoardodile/ui/icons/marks"
import {
	AltArrowDown,
	AltArrowRight,
	AltArrowUp,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { KeyboardEvent, Ref } from "react"
import { useTranslation } from "react-i18next"

export type DocFindBarProps = Readonly<{
	readonly query: string
	readonly replacement: string
	readonly caseSensitive: boolean
	/** 1-based position of the active match; 0 when there is no match. */
	readonly currentIndex: number
	readonly total: number
	/** Whether the replace row is expanded (it starts collapsed). */
	readonly replaceOpen: boolean
	/** Hides the replace controls where the body cannot be edited. */
	readonly readOnly: boolean
	readonly inputRef: Ref<HTMLInputElement>
	readonly replacementRef: Ref<HTMLInputElement>
	readonly onQueryChange: (value: string) => void
	readonly onReplacementChange: (value: string) => void
	readonly onToggleCase: () => void
	readonly onToggleReplace: () => void
	readonly onNext: () => void
	readonly onPrevious: () => void
	readonly onReplace: () => void
	readonly onReplaceAll: () => void
	/** Editor history: Ctrl/Cmd+Z is intercepted so it undoes the document. */
	readonly onUndo: () => void
	readonly onRedo: () => void
	readonly onClose: () => void
}>

/**
 * In-document find & replace widget: the editor's compact, floating
 * counterpart of VS Code's find control. It is pinned under the sticky
 * formatting toolbar (see `EditorStaticToolbar`'s `findPanel` slot) rather
 * than sitting in the document flow, so the reader keeps scrolling,
 * selecting and typing while the matches stay highlighted.
 *
 * Presentation only — the query, the matches and the replacements all live
 * in `useDocFind`. The replace row stays collapsed until the user expands
 * it (the leading chevron, or `Ctrl+H`), which keeps the widget one line
 * tall while searching.
 *
 * `Enter` advances (Shift+Enter goes back), Enter in the replacement field
 * swaps the active match, and `Escape` dismisses the widget. Both fields
 * keep the editor's undo shortcuts working: the caret lives here while the
 * user replaces, so Ctrl/Cmd+Z is forwarded to the document rather than to
 * the input's own (empty) history.
 */
export function DocFindBar(props: DocFindBarProps) {
	const { t } = useTranslation()
	const hasMatches = props.total > 0
	const replaceDisabled = props.readOnly || !hasMatches
	const showReplaceRow = props.replaceOpen && !props.readOnly

	/** Ctrl/Cmd+Z / Ctrl+Y / Ctrl+Shift+Z, routed to the editor history. */
	function handleHistoryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault()
			if (event.shiftKey) props.onRedo()
			else props.onUndo()
			return true
		}
		if (event.key.toLowerCase() === "y" && event.ctrlKey) {
			event.preventDefault()
			props.onRedo()
			return true
		}
		return false
	}

	function handleFindKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (handleHistoryKeyDown(event)) return
		if (event.key === "Enter") {
			event.preventDefault()
			if (event.shiftKey) props.onPrevious()
			else props.onNext()
			return
		}
		if (event.key === "Escape") {
			event.preventDefault()
			props.onClose()
		}
	}

	function handleReplaceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (handleHistoryKeyDown(event)) return
		if (event.key === "Enter") {
			event.preventDefault()
			props.onReplace()
			return
		}
		if (event.key === "Escape") {
			event.preventDefault()
			props.onClose()
		}
	}

	return (
		// The floating-surface recipe the app's menus use: popover fill,
		// hairline ring, menu shadow — compact enough to read as an overlay
		// rather than a second toolbar row.
		<div
			className="flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-1 rounded-md bg-popover p-1 shadow-md ring-1 ring-foreground/10"
			data-testid="document-find-bar"
		>
			<div className="flex items-center gap-0.5">
				{!props.readOnly && (
					<Button
						variant="ghost"
						size="icon"
						className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
						onClick={props.onToggleReplace}
						aria-expanded={props.replaceOpen}
						aria-label={t("documents.find.toggleReplace")}
						title={t("documents.find.toggleReplace")}
						data-testid="document-find-toggle-replace"
					>
						{props.replaceOpen ? (
							<AltArrowDown className="size-3.5" strokeWidth={1.6} />
						) : (
							<AltArrowRight className="size-3.5" strokeWidth={1.6} />
						)}
					</Button>
				)}
				<Input
					ref={props.inputRef}
					value={props.query}
					onChange={(e) => props.onQueryChange(e.target.value)}
					onKeyDown={handleFindKeyDown}
					placeholder={t("documents.find.placeholder")}
					aria-label={t("documents.find.placeholder")}
					maxLength={MAX_SEARCH_QUERY_LENGTH}
					size="sm"
					autoComplete="off"
					className="min-w-0 flex-1"
					data-testid="document-find-input"
				/>
				<span
					className={cn(
						"shrink-0 px-1 text-xs tabular-nums",
						hasMatches ? "text-muted-foreground" : "text-destructive",
					)}
					aria-live="polite"
					data-testid="document-find-count"
				>
					{hasMatches
						? t("documents.find.counter", {
								current: props.currentIndex,
								total: props.total,
							})
						: props.query.trim().length === 0
							? ""
							: t("documents.find.noResults")}
				</span>
				<Button
					variant="ghost"
					size="icon"
					className={cn(
						"size-6 shrink-0 text-xs font-semibold",
						props.caseSensitive
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
					onClick={props.onToggleCase}
					aria-pressed={props.caseSensitive}
					aria-label={t("documents.find.matchCase")}
					title={t("documents.find.matchCase")}
					data-testid="document-find-match-case"
				>
					Aa
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
					onClick={props.onPrevious}
					disabled={!hasMatches}
					aria-label={t("documents.find.previous")}
					title={t("documents.find.previous")}
					data-testid="document-find-prev"
				>
					<AltArrowUp className="size-4" strokeWidth={1.6} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
					onClick={props.onNext}
					disabled={!hasMatches}
					aria-label={t("documents.find.next")}
					title={t("documents.find.next")}
					data-testid="document-find-next"
				>
					<AltArrowDown className="size-4" strokeWidth={1.6} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
					onClick={props.onClose}
					aria-label={t("documents.find.close")}
					title={t("documents.find.close")}
					data-testid="document-find-close"
				>
					<Cross className="size-4" />
				</Button>
			</div>

			{showReplaceRow && (
				<div className="flex items-center gap-0.5">
					<Input
						ref={props.replacementRef}
						value={props.replacement}
						onChange={(e) => props.onReplacementChange(e.target.value)}
						onKeyDown={handleReplaceKeyDown}
						placeholder={t("documents.find.replacePlaceholder")}
						aria-label={t("documents.find.replacePlaceholder")}
						size="sm"
						autoComplete="off"
						className="min-w-0 flex-1"
						data-testid="document-find-replacement"
					/>
					<Button
						variant="secondary"
						size="sm"
						className="h-6 shrink-0 px-2 text-xs"
						onClick={props.onReplace}
						disabled={replaceDisabled}
						data-testid="document-find-replace"
					>
						{t("documents.find.replace")}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						className="h-6 shrink-0 px-2 text-xs"
						onClick={props.onReplaceAll}
						disabled={replaceDisabled}
						data-testid="document-find-replace-all"
					>
						{t("documents.find.replaceAll")}
					</Button>
				</div>
			)}
		</div>
	)
}
