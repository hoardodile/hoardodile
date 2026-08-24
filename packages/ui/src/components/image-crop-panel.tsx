import {
	DialogFooterActions,
	useDialogFooterActions,
} from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Label } from "@hoardodile/ui/components/label"
import { Switch } from "@hoardodile/ui/components/switch"
import { toast } from "@hoardodile/ui/components/toast"
import { Gallery, RefreshCircle, Upload } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CroppedImage } from "./image-cropper"
import { ImageCropper } from "./image-cropper"

export type ImageCropPanelProps = {
	readonly aspect?: number
	readonly mimeType?: "image/png" | "image/jpeg" | "image/webp"
	readonly accept?: string
	readonly previewShape?: "square" | "circle"
	readonly previewWidth?: number
	readonly previewHeight?: number
	/**
	 * Called when the user clicks "save". Receives the cropped image
	 * payload. Should return a promise that resolves once the upload is
	 * complete; the panel then notifies via {@link onSaved}.
	 *
	 * @throws The implementation may throw to surface an error toast.
	 */
	readonly onSave: (cropped: CroppedImage) => Promise<unknown>
	readonly onSaved?: () => void
	/**
	 * Called when the user clicks the action button but no image has been
	 * selected. The parent (e.g. {@link ImageEditPanel}) can treat this as a
	 * request to remove the existing image.
	 */
	readonly onClear?: () => void
	/**
	 * When set (e.g. canvas snapshot object URL), skips the empty picker and
	 * shows the cropper immediately.
	 */
	readonly initialSrc?: string
	/**
	 * When false, hides file pick / drag-drop and "reselect" (preset image only).
	 */
	readonly allowChangeSource?: boolean
	/** Notifies parent when an async save starts / finishes (for dialog guards). */
	readonly onSavingChange?: (saving: boolean) => void
	/** Exact size (px) of the empty picker frame / crop stage. Overrides the default 240×240. */
	readonly cropStageWidth?: number
	readonly cropStageHeight?: number
	/**
	 * When true, the right-hand live preview is hidden until the user turns
	 * the switch on (saves work over large captures / WebGL snapshots).
	 */
	readonly showPreviewSwitch?: boolean
	/**
	 * When true, the live preview pane is never rendered — the crop stage is
	 * the only surface. Used by creation forms whose panel column has no
	 * room for a side-by-side preview.
	 */
	readonly hidePreview?: boolean
	/**
	 * When true, the crop stage fills its parent width and keeps the aspect
	 * ratio implied by {@link cropStageWidth} / {@link cropStageHeight}
	 * (full-bleed `aspect-square w-full` panels). Ignored when only
	 * one stage dimension is given.
	 */
	readonly fillWidth?: boolean
	/** Extra classes on the root panel wrapper. */
	readonly panelClassName?: string
	/** Extra classes on the row that holds the crop stage + preview. */
	readonly containerClassName?: string
	/** Extra classes on the column wrapping the crop stage (e.g. flex-1 min-w-0). */
	readonly cropColumnClassName?: string
	/** Extra classes on the bordered crop stage box (merged with defaults via tailwind-merge). */
	readonly cropStageClassName?: string
	/** When true, the bottom save/remove action button is hidden. */
	readonly hideActionButton?: boolean
	/**
	 * When true, automatically calls {@link onSave} after the user finishes
	 * adjusting the crop (debounced by 600 ms). Useful when the action button
	 * is hidden and the parent only needs the final crop at form-submit time.
	 */
	readonly autoSaveOnCrop?: boolean
}

/**
 * Inline image picker + cropper with live preview.
 */
export function ImageCropPanel(props: ImageCropPanelProps) {
	const {
		aspect,
		mimeType = "image/png",
		accept = "image/*",
		previewShape = "square",
		previewWidth: previewWidthProp,
		previewHeight: previewHeightProp,
		onSave,
		onSaved,
		onClear,
		initialSrc,
		allowChangeSource = true,
		onSavingChange,
		cropStageWidth,
		cropStageHeight,
		showPreviewSwitch = false,
		hidePreview = false,
		fillWidth = false,
		panelClassName,
		containerClassName,
		cropColumnClassName,
		cropStageClassName,
		hideActionButton = false,
		autoSaveOnCrop = false,
	} = props
	const { t } = useTranslation("ui", { useSuspense: false })
	const footerSlot = useDialogFooterActions()
	const previewWidth = previewWidthProp ?? cropStageWidth ?? 200
	const previewHeight = previewHeightProp ?? cropStageHeight ?? 200
	const effectiveCropWidth = cropStageWidth ?? 320
	const effectiveCropHeight = cropStageHeight ?? 240
	// Full-bleed stage: the aspect ratio of the requested stage dimensions,
	// stretched to whatever width the parent column gives us.
	const stageAspectRatio =
		fillWidth && cropStageWidth !== undefined && cropStageHeight !== undefined
			? `${cropStageWidth} / ${cropStageHeight}`
			: undefined
	const previewToggleId = useId()
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [imageSrc, setImageSrc] = useState<string | undefined>(initialSrc)
	const renderRef = useRef<(() => Promise<CroppedImage>) | undefined>(undefined)
	const [previewDataUrl, setPreviewDataUrl] = useState<string | undefined>(
		undefined,
	)
	const [previewPaneOn, setPreviewPaneOn] = useState(false)
	const [dragOver, setDragOver] = useState(false)
	const [saving, setSaving] = useState(false)
	const previewVisible = !hidePreview && (!showPreviewSwitch || previewPaneOn)
	const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	)
	const callbacksRef = useRef({ onSave, onSaved, onSavingChange, t })
	callbacksRef.current = { onSave, onSaved, onSavingChange, t }

	useEffect(
		function syncInitialSrc() {
			if (initialSrc !== undefined) setImageSrc(initialSrc)
		},
		[initialSrc],
	)

	const handleCropReady = useCallback(
		(render: () => Promise<CroppedImage>) => {
			renderRef.current = render
			if (autoSaveOnCrop) {
				if (autoSaveTimerRef.current) {
					clearTimeout(autoSaveTimerRef.current)
				}
				autoSaveTimerRef.current = setTimeout(() => {
					render()
						.then(async (cropped) => {
							const { onSave, onSaved, onSavingChange, t } =
								callbacksRef.current
							try {
								setSaving(true)
								onSavingChange?.(true)
								await onSave(cropped)
								onSaved?.()
							} catch (err) {
								const msg = err instanceof Error ? err.message : String(err)
								toast.add({
									title: msg || t("imageCrop.saveFailed"),
									type: "error",
								})
							} finally {
								setSaving(false)
								onSavingChange?.(false)
							}
						})
						.catch((err) => {
							const { t } = callbacksRef.current
							const msg = err instanceof Error ? err.message : String(err)
							toast.add({
								title: msg || t("imageCrop.saveFailed"),
								type: "error",
							})
						})
				}, 600)
			}
		},
		[autoSaveOnCrop],
	)

	const handlePreviewChange = useCallback((dataUrl: string) => {
		setPreviewDataUrl(dataUrl)
	}, [])

	function handlePreviewToggle(on: boolean) {
		setPreviewPaneOn(on)
		if (!on) setPreviewDataUrl(undefined)
	}

	function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0]
		if (file === undefined) return
		readFileAsDataUrl(file)
	}

	function handleDrop(e: React.DragEvent<HTMLElement>) {
		e.preventDefault()
		setDragOver(false)
		const file = e.dataTransfer.files?.[0]
		if (file !== undefined) readFileAsDataUrl(file)
	}

	function readFileAsDataUrl(file: File) {
		const reader = new FileReader()
		reader.addEventListener("load", () => {
			const result = reader.result
			if (typeof result === "string") setImageSrc(result)
		})
		reader.readAsDataURL(file)
	}

	function handleReselect() {
		if (autoSaveTimerRef.current) {
			clearTimeout(autoSaveTimerRef.current)
			autoSaveTimerRef.current = undefined
		}
		setImageSrc(undefined)
		renderRef.current = undefined
		setPreviewDataUrl(undefined)
		setPreviewPaneOn(false)
		fileInputRef.current?.click()
	}

	async function handleSave() {
		const render = renderRef.current
		if (render === undefined) {
			onClear?.()
			return
		}
		setSaving(true)
		onSavingChange?.(true)
		try {
			const cropped = await render()
			await onSave(cropped)
			onSaved?.()
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			toast.add({
				title: msg || t("imageCrop.saveFailed"),
				type: "error",
			})
		} finally {
			setSaving(false)
			onSavingChange?.(false)
		}
	}

	const previewRadiusClass =
		previewShape === "circle" ? "rounded-full" : "rounded"

	const actionButton = (
		<Button
			type="button"
			onClick={handleSave}
			disabled={saving}
			data-testid="image-crop-save"
		>
			{saving
				? t("imageCrop.saving")
				: imageSrc === undefined
					? t("imageCrop.remove")
					: t("imageCrop.save")}
		</Button>
	)

	return (
		<div className={cn("flex flex-col gap-4", panelClassName)}>
			{allowChangeSource ? (
				<input
					ref={fileInputRef}
					type="file"
					accept={accept}
					className="hidden"
					onChange={handleFileChange}
					data-testid="image-crop-file-input"
				/>
			) : null}

			<div
				className={cn(
					"flex flex-col items-center gap-6 py-2 sm:flex-row sm:items-center sm:justify-center",
					containerClassName,
				)}
			>
				<div
					className={cn(
						"flex flex-col items-center gap-2",
						stageAspectRatio !== undefined && "w-full",
						cropColumnClassName,
					)}
				>
					{imageSrc === undefined ? (
						allowChangeSource ? (
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								onDragOver={(e) => {
									e.preventDefault()
									setDragOver(true)
								}}
								onDragLeave={() => setDragOver(false)}
								onDrop={handleDrop}
								className={cn(
									"flex select-none flex-col items-center justify-center gap-2 rounded-md border border-border bg-muted text-muted-foreground transition-colors duration-300 hover:bg-accent hover:text-accent-foreground",
									dragOver && "bg-accent text-accent-foreground",
									stageAspectRatio !== undefined && "w-full",
								)}
								data-testid="image-crop-frame"
								style={
									stageAspectRatio !== undefined
										? { aspectRatio: stageAspectRatio }
										: {
												width: cropStageWidth ?? 240,
												height: cropStageHeight ?? 240,
											}
								}
							>
								<Upload className="size-5" />
								<p className="text-sm">{t("imageCrop.pickHint")}</p>
							</button>
						) : (
							<div
								className={cn(
									"flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground",
									stageAspectRatio !== undefined && "w-full",
								)}
								style={
									stageAspectRatio !== undefined
										? { aspectRatio: stageAspectRatio }
										: {
												width: cropStageWidth ?? 240,
												height: cropStageHeight ?? 240,
											}
								}
							>
								{t("imageCrop.pickHint")}
							</div>
						)
					) : (
						<div
							className={cn(
								"flex min-h-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card",
								stageAspectRatio === undefined && "max-w-90",
								cropStageClassName,
								stageAspectRatio !== undefined && "w-full",
							)}
							style={
								stageAspectRatio !== undefined
									? { aspectRatio: stageAspectRatio }
									: {
											minHeight: `${cropStageHeight}px`,
											minWidth: `${cropStageWidth}px`,
											width: effectiveCropWidth,
											height: effectiveCropHeight,
											maxWidth: effectiveCropWidth,
											maxHeight: effectiveCropHeight,
										}
							}
						>
							<ImageCropper
								src={imageSrc}
								aspect={aspect}
								mimeType={mimeType}
								displayMaxWidth={
									stageAspectRatio !== undefined ? "100%" : effectiveCropWidth
								}
								displayMaxHeight={
									stageAspectRatio !== undefined
										? undefined
										: effectiveCropHeight
								}
								onCropReady={handleCropReady}
								onPreviewChange={
									previewVisible ? handlePreviewChange : undefined
								}
						/>
					</div>
					)}
					{imageSrc !== undefined && allowChangeSource ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={handleReselect}
							className="text-muted-foreground text-xs"
						>
							<RefreshCircle className="mr-1 h-3.5 w-3.5" />
							{t("imageCrop.reselect")}
						</Button>
					) : null}
				</div>

				{previewVisible ? (
					<>
						<div className={cn("hidden w-px bg-border sm:block h-40")} />
						<div className={cn("block bg-border sm:hidden h-px w-32")} />

						<div className={cn("flex shrink-0 flex-col items-center gap-1.5")}>
							<div
								style={{ width: previewWidth, height: previewHeight }}
								className={cn(
									"flex items-center justify-center overflow-hidden border border-border bg-muted text-muted-foreground",
									previewRadiusClass,
								)}
								data-testid="image-crop-preview"
								title={t("imageCrop.previewLabel")}
							>
								{previewDataUrl !== undefined ? (
									<img
										src={previewDataUrl}
										alt={t("imageCrop.previewAlt")}
										className="max-h-full max-w-full object-cover"
									/>
								) : (
									<Gallery className="h-10 w-10 opacity-60" />
								)}
							</div>
						</div>
					</>
				) : null}
			</div>

			{showPreviewSwitch && imageSrc !== undefined ? (
				<div className={cn("flex items-center justify-center gap-2")}>
					<Switch
						id={previewToggleId}
						checked={previewPaneOn}
						onCheckedChange={handlePreviewToggle}
						data-testid="image-crop-preview-toggle"
					/>
					<Label
						htmlFor={previewToggleId}
						className="text-muted-foreground cursor-pointer text-sm font-normal"
					>
						{t("imageCrop.showPreview")}
					</Label>
				</div>
			) : null}

			{/* The save/remove action lands on the surrounding dialog's
			    footer row — side by side with Cancel. Outside a dialog it
			    falls back to an inline row at the panel's bottom. */}
			{!hideActionButton &&
				(footerSlot === null ? (
					<div className={cn("flex justify-end pt-2")}>{actionButton}</div>
				) : (
					<DialogFooterActions>{actionButton}</DialogFooterActions>
				))}
		</div>
	)
}
