import { Icon } from "@hoardodile/ui/components/icon"
import { Magnifier } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import {
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useEffect,
	useState,
} from "react"
import { useDebounce } from "react-use"

export type SearchFieldProps = {
	/** The committed value; the input re-syncs to it on external changes. */
	readonly value: string
	readonly placeholder?: string
	/**
	 * Layout overrides — the hero form passes `h-11 px-4` (the sidebar
	 * h-nav and the hero h-11 share one anatomy).
	 */
	readonly className?: string
	/** Optional actions rendered at the trailing edge of the field. */
	readonly actions?: ReactNode
	/** Input length cap (e.g. the app's max search-query length). */
	readonly maxLength?: number
	/**
	 * Debounced commit of the draft (unless {@link commitOnEnterOnly}).
	 * Filter bars pass their live patch here.
	 */
	readonly onCommit?: (value: string) => void
	/** Enter / form submit — navigation and apply-on-demand surfaces. */
	readonly onSubmit?: (value: string) => void
	/**
	 * When true, keystrokes never debounce-commit; the value is delivered
	 * only through {@link onSubmit} (Enter). Used by apply-on-demand
	 * surfaces where typing stages and Enter applies.
	 */
	readonly commitOnEnterOnly?: boolean
	readonly delayMs?: number
	/** Optional ref to the inner input (sidebar "/" and Ctrl/Cmd+K). */
	readonly inputRef?: Ref<HTMLInputElement>
	readonly testId?: string
}

/**
 * The one search field: muted fill, rounded-lg, leading magnifier,
 * muted placeholder — sidebar (h-nav) and hero (h-11) share this
 * anatomy, as do the index-page filter bars. Commit semantics are the
 * caller's: debounced {@link onCommit} for live filtering, Enter through
 * {@link onSubmit} for navigation and apply-on-demand surfaces.
 *
 * The root is a div, not a form: the field nests inside page forms (the
 * new character/resource editors, which wrap their whole body in one), so
 * a nested form would be invalid HTML. Enter is captured on keydown and
 * preventDefaulted, so it never submits an enclosing form either.
 */
export function SearchField(props: SearchFieldProps) {
	const {
		value,
		placeholder,
		className,
		actions,
		maxLength,
		onCommit,
		onSubmit,
		commitOnEnterOnly,
		delayMs,
		inputRef,
		testId,
	} = props
	const [draft, setDraft] = useState(value)

	useEffect(() => {
		setDraft(value)
	}, [value])

	useDebounce(
		() => {
			if (commitOnEnterOnly) return
			if (draft !== value) onCommit?.(draft)
		},
		delayMs ?? 300,
		[draft],
	)

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key !== "Enter") return
		event.preventDefault()
		if (commitOnEnterOnly) {
			onSubmit?.(draft)
			return
		}
		if (draft !== value) onCommit?.(draft)
		onSubmit?.(draft)
	}

	return (
		<div
			onKeyDown={handleKeyDown}
			className={cn(
				"flex h-nav items-center gap-2 rounded-lg bg-muted px-3",
				className,
			)}
		>
			<Icon icon={Magnifier} className="shrink-0 text-muted-foreground" />
			<input
				ref={inputRef}
				type="text"
				value={draft}
				onChange={(ev) => setDraft(ev.target.value)}
				placeholder={placeholder}
				maxLength={maxLength}
				className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
				data-testid={testId ?? "global-search-input"}
			/>
			{actions}
		</div>
	)
}
