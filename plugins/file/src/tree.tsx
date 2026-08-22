import type { ItemInstance, TreeInstance } from "@headless-tree/core"
import { Add } from "@hoardodile/ui/icons/actions"
import { cn } from "@hoardodile/ui/lib/utils"
import { AltArrowDownIcon as AltArrowDown } from "@solar-icons/react/linear/alt-arrow-down"
import {
	type ButtonHTMLAttributes,
	type CSSProperties,
	createContext,
	type HTMLAttributes,
	useContext,
} from "react"

type ToggleIconType = "chevron" | "plus-minus"

interface TreeContextValue<T = any> {
	indent: number
	currentItem?: ItemInstance<T>
	tree?: () => TreeInstance<T>
	toggleIconType?: ToggleIconType
}

const TreeContext = createContext<TreeContextValue>({
	indent: 20,
	currentItem: undefined,
	tree: undefined,
	toggleIconType: "plus-minus",
})

function useTreeContext<T = any>() {
	return useContext(TreeContext) as TreeContextValue<T>
}

interface TreeProps<T = any> extends HTMLAttributes<HTMLDivElement> {
	indent?: number
	/**
	 * Render function returned by the react-compiler build of `useTree`.
	 * Invoked during render so the React Compiler cache re-evaluates the
	 * tree's stateful methods instead of freezing them on the first call.
	 */
	renderTree?: () => TreeInstance<T>
	toggleIconType?: ToggleIconType
}

function Tree<T = any>({
	indent = 20,
	renderTree,
	className,
	toggleIconType = "chevron",
	...props
}: TreeProps<T>) {
	const tree = renderTree?.()
	const containerProps =
		tree && typeof tree.getContainerProps === "function"
			? tree.getContainerProps()
			: {}
	const mergedProps = { ...props, ...containerProps }

	// Extract style from mergedProps to merge with our custom styles
	const { style: propStyle, ...otherProps } = mergedProps

	// Merge styles
	const mergedStyle = {
		...propStyle,
		"--tree-indent": `${indent}px`,
	} as CSSProperties

	return (
		<TreeContext.Provider value={{ indent, tree: renderTree, toggleIconType }}>
			<div
				data-slot="tree"
				style={mergedStyle}
				className={cn("flex flex-col", className)}
				{...otherProps}
			/>
		</TreeContext.Provider>
	)
}

interface TreeItemProps<T = any>
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "indent"> {
	item: ItemInstance<T>
	indent?: number
}

function TreeItem<T = any>({
	item,
	className,
	children,
	...props
}: TreeItemProps<T>) {
	const parentContext = useTreeContext<T>()
	const { indent } = parentContext

	const itemProps = typeof item.getProps === "function" ? item.getProps() : {}
	const mergedProps = { ...props, children, ...itemProps }

	// Extract style from mergedProps to merge with our custom styles
	const { style: propStyle, ...otherProps } = mergedProps

	// Merge styles
	const mergedStyle = {
		...propStyle,
		"--tree-padding": `${item.getItemMeta().level * indent}px`,
	} as CSSProperties

	const defaultProps = {
		"data-slot": "tree-item",
		style: mergedStyle,
		className: cn(
			"z-10 ps-(--tree-padding) outline-hidden select-none not-last:pb-0.5 focus:z-20 data-disabled:pointer-events-none data-disabled:opacity-50",
			className,
		),
		"data-focus":
			typeof item.isFocused === "function"
				? item.isFocused() || false
				: undefined,
		"data-folder":
			typeof item.isFolder === "function"
				? item.isFolder() || false
				: undefined,
		"data-selected":
			typeof item.isSelected === "function"
				? item.isSelected() || false
				: undefined,
		"data-drag-target":
			typeof item.isDragTarget === "function"
				? item.isDragTarget() || false
				: undefined,
		"data-search-match":
			typeof item.isMatchingSearch === "function"
				? item.isMatchingSearch() || false
				: undefined,
		"aria-expanded": item.isExpanded(),
	}

	return (
		<TreeContext.Provider value={{ ...parentContext, currentItem: item }}>
			<button {...defaultProps} {...otherProps}>
				{children}
			</button>
		</TreeContext.Provider>
	)
}

interface TreeItemLabelProps<T = any> extends HTMLAttributes<HTMLSpanElement> {
	item?: ItemInstance<T>
}

function TreeItemLabel<T = any>({
	item: propItem,
	children,
	className,
	...props
}: TreeItemLabelProps<T>) {
	const { currentItem, toggleIconType } = useTreeContext<T>()
	const item = propItem || currentItem

	if (!item) {
		console.warn("TreeItemLabel: No item provided via props or context")
		return null
	}

	return (
		<span
			data-slot="tree-item-label"
			className={cn(
				"in-focus-visible:ring-ring/50 bg-background text-foreground hover:bg-accent in-data-[selected=true]:bg-accent in-data-[selected=true]:text-accent-foreground in-data-[drag-target=true]:bg-accent flex items-center gap-1 transition-colors not-in-data-[folder=true]:ps-7 in-focus-visible:ring-[3px] in-data-[search-match=true]:bg-blue-50! [&_svg]:pointer-events-none [&_svg]:shrink-0",
				"rounded-sm",
				"py-1.5",
				"px-2",
				"text-sm",
				className,
			)}
			{...props}
		>
			{item.isFolder() &&
				(toggleIconType === "plus-minus" ? (
					item.isExpanded() ? (
						<span
							className="flex size-3.5 items-center justify-center text-muted-foreground"
							aria-hidden="true"
						>
							<svg
								viewBox="0 0 24 24"
								className="size-3.5"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								strokeLinecap="round"
							>
								<path d="M5 12h14" />
							</svg>
						</span>
					) : (
						<Add className="text-muted-foreground size-3.5" />
					)
				) : (
					<AltArrowDown className="text-muted-foreground size-4 in-aria-[expanded=false]:-rotate-90" />
				))}
			{children ||
				(typeof item.getItemName === "function" ? item.getItemName() : null)}
		</span>
	)
}

function TreeDragLine({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	const { tree } = useTreeContext()
	const treeInstance = tree?.()

	if (!treeInstance || typeof treeInstance.getDragLineStyle !== "function") {
		console.warn(
			"TreeDragLine: No tree provided via context or tree does not have getDragLineStyle method",
		)
		return null
	}

	const dragLine = treeInstance.getDragLineStyle()
	return (
		<div
			style={dragLine}
			className={cn(
				"bg-primary before:bg-background before:border-primary absolute z-30 -mt-px h-0.5 w-[unset] before:absolute before:top-[-3px] before:left-0 before:size-2 before:border-2",
				"before:rounded-full",
				className,
			)}
			{...props}
		/>
	)
}

export { Tree, TreeDragLine, TreeItem, TreeItemLabel }
