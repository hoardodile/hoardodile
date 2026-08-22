import { fireEvent, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type CroppedImage, ImageCropper } from "./image-cropper"

beforeEach(() => {
	const context = {
		drawImage: vi.fn(),
		imageSmoothingQuality: "",
	}
	HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as never
	HTMLCanvasElement.prototype.toDataURL = vi.fn(
		() => "data:image/png;base64,",
	) as never
	HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
		callback?.(new Blob([""], { type: "image/png" }))
	}) as never
})

const TALL_IMAGE_SRC =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1000' height='2000'%3E%3Crect width='100%25' height='100%25' fill='red'/%3E%3C/svg%3E"
const SQUARE_IMAGE_SRC =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='804' height='804'%3E%3Crect width='100%25' height='100%25' fill='red'/%3E%3C/svg%3E"

describe("ImageCropper", () => {
	it("fills a tall image with a square aspect crop", async () => {
		let renderCrop: (() => Promise<CroppedImage>) | undefined

		render(
			<ImageCropper
				src={TALL_IMAGE_SRC}
				aspect={1}
				onCropReady={(render) => {
					renderCrop = render
				}}
			/>,
		)

		const img = await waitFor(() => {
			const el = document.querySelector("img")
			expect(el).toBeInTheDocument()
			return el as HTMLImageElement
		})

		// Natural size is 1000x2000, but the image is displayed at 200x400.
		// The output must still be a 1000x1000 square based on natural pixels.
		setImageSize(img, {
			naturalWidth: 1000,
			naturalHeight: 2000,
			width: 200,
			height: 400,
		})
		fireEvent.load(img)

		await waitFor(() => expect(renderCrop).toBeDefined())
		const cropped = await renderCrop!()

		expect(cropped.width).toBe(1000)
		expect(cropped.height).toBe(1000)
	})

	it("keeps a square image square with a 1:1 aspect crop", async () => {
		let renderCrop: (() => Promise<CroppedImage>) | undefined

		render(
			<ImageCropper
				src={SQUARE_IMAGE_SRC}
				aspect={1}
				onCropReady={(render) => {
					renderCrop = render
				}}
			/>,
		)

		const img = await waitFor(() => {
			const el = document.querySelector("img")
			expect(el).toBeInTheDocument()
			return el as HTMLImageElement
		})

		// Natural size is 804x804, displayed much smaller (e.g. 200x200).
		// The output must remain exactly 804x804.
		setImageSize(img, {
			naturalWidth: 804,
			naturalHeight: 804,
			width: 200,
			height: 200,
		})
		fireEvent.load(img)

		await waitFor(() => expect(renderCrop).toBeDefined())
		const cropped = await renderCrop!()

		expect(cropped.width).toBe(804)
		expect(cropped.height).toBe(804)
	})

	it("uses the full image when no aspect is provided", async () => {
		let renderCrop: (() => Promise<CroppedImage>) | undefined

		render(
			<ImageCropper
				src={TALL_IMAGE_SRC}
				onCropReady={(render) => {
					renderCrop = render
				}}
			/>,
		)

		const img = await waitFor(() => {
			const el = document.querySelector("img")
			expect(el).toBeInTheDocument()
			return el as HTMLImageElement
		})

		setImageSize(img, {
			naturalWidth: 1000,
			naturalHeight: 2000,
			width: 200,
			height: 400,
		})
		fireEvent.load(img)

		await waitFor(() => expect(renderCrop).toBeDefined())
		const cropped = await renderCrop!()

		expect(cropped.width).toBe(1000)
		expect(cropped.height).toBe(2000)
	})
})

function setImageSize(
	img: HTMLImageElement,
	size: {
		naturalWidth: number
		naturalHeight: number
		width: number
		height: number
	},
): void {
	Object.defineProperty(img, "naturalWidth", { value: size.naturalWidth })
	Object.defineProperty(img, "naturalHeight", { value: size.naturalHeight })
	Object.defineProperty(img, "width", { value: size.width })
	Object.defineProperty(img, "height", { value: size.height })
}
