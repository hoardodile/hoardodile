import "./index.css"

import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core"
import { useTree } from "@headless-tree/react/react-compiler"
import { createPluginRoot } from "@hoardodile/sdk-react"
import { fileTypeFromName } from "@hoardodile/sdk-types"
import { Badge } from "@hoardodile/ui/components/badge"
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@hoardodile/ui/components/empty"
import { Spinner } from "@hoardodile/ui/components/spinner"
import { cn } from "@hoardodile/ui/lib/utils"
import { FileIcon as File } from "@solar-icons/react/linear/file"
import { FolderIcon as Folder } from "@solar-icons/react/linear/folder"
import { FolderOpenIcon as FolderOpen } from "@solar-icons/react/linear/folder-open"
import { useMemo, useState } from "react"
import { PluginAPIProvider, usePluginAPI } from "./hooks"
import { useTranslation } from "./i18n"
import type { FileEntry } from "./shared"
import { Tree, TreeItem, TreeItemLabel } from "./tree"

function formatSize(bytes: number | undefined): string {
	if (bytes === undefined) return "—"
	if (bytes === 0) return "0 B"
	const units = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log10(bytes) / 3)
	const unit = units[Math.min(i, units.length - 1)]
	const value = bytes / 1000 ** i
	return `${value.toFixed(1)} ${unit}`
}

interface TreeNode {
	id: string
	name: string
	ext?: string
	sizeBytes?: number
	children?: string[]
}

function buildTreeData(files: readonly FileEntry[]): {
	items: Record<string, TreeNode>
	folderIds: string[]
} {
	const items: Record<string, TreeNode> = {
		root: { id: "root", name: "root", children: [] },
	}
	const folderIds = new Set<string>(["root"])

	for (const file of files) {
		const isDir = file.filename.endsWith("/")
		const cleanPath = isDir ? file.filename.slice(0, -1) : file.filename
		const parts = cleanPath.split("/")

		// Build intermediate directories
		let currentPath = ""
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i]!
			const parentPath = currentPath || "root"
			currentPath = currentPath ? `${currentPath}/${part}` : part

			if (!items[currentPath]) {
				items[currentPath] = { id: currentPath, name: part, children: [] }
				folderIds.add(currentPath)
			}

			const parent = items[parentPath]
			if (parent?.children && !parent.children.includes(currentPath)) {
				parent.children.push(currentPath)
			}
		}

		// Leaf node
		const name = parts[parts.length - 1]!
		const id = cleanPath
		const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "root"

		if (isDir) {
			if (!items[id]) {
				items[id] = { id, name, children: [] }
				folderIds.add(id)
			} else if (!items[id].children) {
				items[id].children = []
			}
		} else {
			items[id] = { id, name, ext: file.ext, sizeBytes: file.sizeBytes }
		}

		const parent = items[parentPath]
		if (parent?.children && !parent.children.includes(id)) {
			parent.children.push(id)
		}
	}

	// Sort children: folders first, then natural order — the same
	// comparator as the server's `naturalSort` (case-insensitive, numeric),
	// so the tree's order matches the plugin hook's output.
	for (const item of Object.values(items)) {
		if (item.children) {
			item.children.sort((a, b) => {
				const aIsDir = !!items[a]?.children
				const bIsDir = !!items[b]?.children
				if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
				return a.localeCompare(b, undefined, {
					sensitivity: "base",
					numeric: true,
				})
			})
		}
	}

	return { items, folderIds: Array.from(folderIds) }
}

const indent = 20

/**
 * Preview pane for the selected file. Images load the server-rendered
 * preview variant (`?size=preview`), video/audio stream the original
 * bytes (range-capable), everything else shows name and size. Virtual
 * paths (`outer!inner`) work out of the box — the URL resolver
 * tokenizes them and the server renders inner entries on demand.
 */
export function FilePreviewPane(props: {
	readonly filename: string
	readonly sizeBytes?: number
	readonly resolveFileUrl: (
		filename: string,
		size?: "preview" | "original",
	) => string
}) {
	const { filename, sizeBytes, resolveFileUrl } = props
	const kind = fileTypeFromName(filename)?.kind
	if (kind === "image") {
		return (
			<img
				key={filename}
				src={resolveFileUrl(filename, "preview")}
				alt={filename}
				className="h-full w-full object-contain"
				data-testid="file-preview-image"
			/>
		)
	}
	if (kind === "video") {
		return (
			// biome-ignore lint/a11y/useMediaCaption: arbitrary user media has no caption source
			<video
				key={filename}
				src={resolveFileUrl(filename)}
				controls
				aria-label={filename}
				className="h-full w-full object-contain"
				data-testid="file-preview-video"
			/>
		)
	}
	if (kind === "audio") {
		return (
			// biome-ignore lint/a11y/useMediaCaption: arbitrary user media has no caption source
			<audio
				key={filename}
				src={resolveFileUrl(filename)}
				controls
				aria-label={filename}
				className="w-full"
				data-testid="file-preview-audio"
			/>
		)
	}
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
			<File className="size-8" />
			<span className="max-w-full truncate">{filename}</span>
			{sizeBytes !== undefined ? <span>{formatSize(sizeBytes)}</span> : null}
		</div>
	)
}

function FileTreeContent(props: {
	readonly files: readonly FileEntry[]
	readonly selected?: string
	readonly onSelect?: (filename: string) => void
}) {
	const { files, selected, onSelect } = props
	const { t } = useTranslation()
	const { items, folderIds } = useMemo(() => buildTreeData(files), [files])

	// The react-compiler build of the tree hook returns a render function
	// (`() => tree`) instead of the tree object: the hook's result is
	// re-created on every render, so the React Compiler cache key changes
	// and `getItems()` re-runs instead of freezing on the first (empty)
	// snapshot. Everything else uses the tree through this function too.
	const renderTree = useTree<TreeNode>({
		initialState: {
			expandedItems: folderIds,
		},
		indent,
		rootItemId: "root",
		getItemName: (item) => item.getItemData().name,
		isItemFolder: (item) => (item.getItemData()?.children?.length ?? 0) > 0,
		dataLoader: {
			getItem: (itemId) => items[itemId]!,
			getChildren: (itemId) => items[itemId]!.children ?? [],
		},
		features: [syncDataLoaderFeature, hotkeysCoreFeature],
	})

	// Serialized expansion state doubles as a render key below: toggling a
	// folder rebuilds the item components, resetting their compiler caches
	// so `isExpanded()`/`getItemMeta()` reflect the new state instead of
	// the values frozen at first render.
	const expandedKey = renderTree().getState().expandedItems.join(",")

	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<div className="flex items-center gap-2 border-b px-4 py-3">
				<span className="text-sm font-medium">{t("fileTree")}</span>
				<Badge variant="secondary">{files.length}</Badge>
			</div>
			<div className="flex-1 overflow-auto">
				<Tree indent={indent} renderTree={renderTree}>
					{renderTree()
						.getItems()
						.map((item) => {
							if (item.getId() === "root") return null
							const data = item.getItemData()
							const isLeaf = !item.isFolder()
							const isSelected = isLeaf && selected === item.getId()

							return (
								<TreeItem key={`${item.getId()}:${expandedKey}`} item={item}>
									<TreeItemLabel
										// headless-tree's item getProps own the
										// button handlers, so selection lives on
										// the label itself.
										onClick={
											isLeaf && onSelect !== undefined
												? () => onSelect(item.getId())
												: undefined
										}
										className={cn(
											isSelected && "bg-accent text-accent-foreground",
										)}
									>
										<span className="flex items-center gap-2 text-foreground">
											{item.isFolder() ? (
												item.isExpanded() ? (
													<FolderOpen className="text-muted-foreground pointer-events-none size-4" />
												) : (
													<Folder className="text-muted-foreground pointer-events-none size-4" />
												)
											) : (
												<File className="text-muted-foreground pointer-events-none size-4" />
											)}
											{data.name}
										</span>
										{!item.isFolder() && (
											<span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
												<span className="w-16 text-right tabular-nums">
													{formatSize(data.sizeBytes)}
												</span>
											</span>
										)}
									</TreeItemLabel>
								</TreeItem>
							)
						})}
				</Tree>
			</div>
		</div>
	)
}

function FileTreeView() {
	const { t } = useTranslation()
	const api = usePluginAPI()
	const { data: files, isLoading } = api.useFileList()
	const [selected, setSelected] = useState<string | undefined>(undefined)

	// No visibility gate: the host's preview window pre-paints parked
	// neighbor slots offscreen, and an empty tree while invisible would
	// defeat that prerender. Nothing here needs pausing.
	if (isLoading || files === undefined) {
		return (
			<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
				<Spinner />
				<span>Loading...</span>
			</div>
		)
	}

	if (files.length === 0) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FolderOpen className="size-6" />
					</EmptyMedia>
					<EmptyTitle>{t("noFiles")}</EmptyTitle>
				</EmptyHeader>
			</Empty>
		)
	}

	const selectedEntry =
		selected !== undefined
			? files.find((entry) => entry.filename === selected)
			: undefined

	return (
		<div className="flex h-full">
			<div className="min-w-0 flex-1">
				<FileTreeContent
					files={files}
					selected={selected}
					onSelect={setSelected}
				/>
			</div>
			{selected !== undefined && (
				<aside className="flex w-80 shrink-0 flex-col border-l bg-background">
					<FilePreviewPane
						filename={selected}
						sizeBytes={selectedEntry?.sizeBytes}
						resolveFileUrl={api.resolveFileUrl}
					/>
				</aside>
			)}
		</div>
	)
}

export { buildTreeData, FileTreeContent }

createPluginRoot({ provider: PluginAPIProvider, render: FileTreeView })
