import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog"
import {
	DialogFooterActionsContext,
	useDialogFooterActions,
} from "@hoardodile/ui/hooks/use-dialog-footer-actions"
import { cn } from "@hoardodile/ui/lib/utils"
import {
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"

/** Dialog width tiers: the 320–480 narrow slot plus
    the wide working tiers — edit hubs, pickers and selectors get
    real estate; confirmations never leave the narrow slot. */
export type AppDialogSize = "sm" | "md" | "lg" | "xl" | "2xl"

const sizeClasses: Record<AppDialogSize, string> = {
	sm: "sm:max-w-sm",
	md: "sm:max-w-md",
	lg: "sm:max-w-2xl",
	xl: "sm:max-w-3xl",
	"2xl": "sm:max-w-4xl",
}

export { useDialogFooterActions }

/**
 * Declarative footer action: renders nothing in the body and contributes
 * the node to the surrounding dialog's footer (appended after the
 * dialog's own `footer` prop). Panels embed their primary action this way
 * so action buttons live in the footer, never in the body. Outside a
 * dialog (sheets, pickers) it renders nothing — callers keep their inline
 * action bar as the fallback.
 */
export function DialogFooterActions({ children }: { children: ReactNode }) {
	const slot = useDialogFooterActions()
	useEffect(() => {
		if (slot === null) return
		slot.setFooterActions(children)
		return () => slot.setFooterActions(null)
	}, [slot, children])
	return null
}

/**
 * Declarative left-edge footer action: contributes the node to the
 * surrounding dialog's footer front, pushed to the left edge (cancel and
 * the primary action stay right-aligned — DESIGN.md three-button footers).
 * Renders nothing outside a dialog.
 */
export function DialogFooterLeadingActions({
	children,
}: {
	children: ReactNode
}) {
	const slot = useDialogFooterActions()
	useEffect(() => {
		if (slot === null) return
		slot.setLeadingActions(children)
		return () => slot.setLeadingActions(null)
	}, [slot, children])
	return null
}

export type AppDialogProps = Readonly<{
	open: boolean
	onOpenChange: (open: boolean) => void
	title: ReactNode
	/** Uppercase section marker above the title (feature dialogs). */
	eyebrow?: ReactNode
	/** Leading icon tile in the title row (feature dialogs). */
	icon?: ReactNode
	/** Danger register — the title ink takes the destructive hue; the
	    danger itself stays in copy and the confirm button. */
	danger?: boolean
	/** Width tier; defaults to `md` (the narrow form slot). */
	size?: AppDialogSize
	/**
	 * Drops the body padding for workspace bodies that own their layout
	 * edge to edge (the two-pane editors); the header keeps its padding
	 * and the footer becomes a plain bottom bar.
	 */
	flush?: boolean
	description?: ReactNode
	children: ReactNode
	/** Leading footer actions; body panels may append theirs via
	    {@link DialogFooterActions}. */
	footer?: ReactNode
	contentClassName?: string
	/** Passed to dialog overlay (e.g. disable backdrop blur over WebGL). */
	overlayClassName?: string
	/** Fade-only motion — lighter than default slide/zoom when over heavy surfaces. */
	contentMotion?: "default" | "minimal"
	/** Defaults to true. Set to false to honour native auto-focus (rare). */
	suppressAutoFocus?: boolean
	contentTestId?: string
}>

/**
 * Standard dialog shell. Wires up `Dialog`/`DialogContent`/`DialogHeader`/
 * `DialogTitle` and an optional eyebrow, icon, description and footer so
 * callers stop re-stating the boilerplate. Use {@link ConfirmDialog} for
 * the common "cancel + primary action" pattern.
 */
export function AppDialog(props: AppDialogProps) {
	const {
		open,
		onOpenChange,
		title,
		eyebrow,
		icon,
		danger,
		size,
		flush,
		description,
		children,
		footer,
		contentClassName,
		overlayClassName,
		contentMotion,
		suppressAutoFocus = true,
		contentTestId,
	} = props
	// Focusing the first focusable element on open would steal the caret
	// from the page underneath, jump scroll position, and on iOS
	// occasionally pop the soft keyboard before the user even reaches an
	// input. Routing focus to the dialog container itself keeps the
	// dialog accessible without those side effects.
	const contentRef = useRef<HTMLDivElement | null>(null)

	// Footer actions contributed by body panels (DialogFooterActions):
	// appended after the dialog's own footer, reset when the dialog closes.
	const [footerActions, setFooterActions] = useState<ReactNode>(null)
	// Left-edge function key (DialogFooterLeadingActions): rendered at the
	// footer's left while cancel + the primary action stay right-aligned
	// (DESIGN.md — three button footers). Reset when the dialog closes.
	const [leadingActions, setLeadingActions] = useState<ReactNode>(null)
	const actionsValue = useMemo(
		() => ({ setFooterActions, setLeadingActions }),
		[setFooterActions, setLeadingActions],
	)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={contentRef}
				className={cn(
					size !== undefined && sizeClasses[size],
					flush && "p-0",
					contentClassName,
				)}
				overlayClassName={overlayClassName}
				contentMotion={contentMotion}
				initialFocus={suppressAutoFocus ? contentRef : undefined}
				data-testid={contentTestId}
			>
				<DialogHeader className={flush ? "gap-4" : undefined}>
					{eyebrow !== undefined ? (
						<span
							className={cn(
								"text-tiny font-semibold tracking-label uppercase",
								danger ? "text-destructive" : "text-muted-foreground",
							)}
						>
							{eyebrow}
						</span>
					) : null}
					<div className="flex min-w-0 items-center gap-3 pr-6">
						{icon}
						<DialogTitle
							className={cn("truncate", danger && "text-destructive")}
						>
							{title}
						</DialogTitle>
					</div>
					{description !== undefined ? (
						<DialogDescription>{description}</DialogDescription>
					) : null}
				</DialogHeader>
				{/* The header, body and footer must stay direct children of
				    DialogContent — its arrangement logic recognises them by
				    type, and a wrapper in between would re-wrap the body in a
				    second DialogBody. The footer-actions context therefore
				    wraps only the body's own content. */}
				<DialogBody className={flush ? "p-0" : undefined}>
					<DialogFooterActionsContext.Provider value={actionsValue}>
						{children}
					</DialogFooterActionsContext.Provider>
				</DialogBody>
				{(footer !== undefined && footer !== null) ||
				footerActions !== null ||
				leadingActions !== null ? (
					// Footer-action placement (DESIGN.md — dialog anatomy):
					// with a primary action the bar splits — the leading
					// function key sits at the left edge while cancel + the
					// primary stay right-aligned ([remove] [cancel] [save]);
					// without a primary the bar never splits — cancel leads
					// and the function key holds the right edge ([cancel]
					// [remove]).
					<DialogFooter flush={flush}>
						{leadingActions !== null && footerActions !== null ? (
							<div className="mr-auto">{leadingActions}</div>
						) : null}
						{footer}
						{footerActions}
						{leadingActions !== null && footerActions === null ? (
							<>{leadingActions}</>
						) : null}
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	)
}
