import type { TraitKind } from "@hoardodile/schemas"
import { MAX_NAME_LENGTH, parseTraitValue } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { Add } from "@hoardodile/ui/icons/actions"
import { MinusSquare } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"

export type TraitValueFieldProps = {
	readonly kind: TraitKind
	readonly value: string
	readonly onChange: (next: string) => void
	readonly placeholder?: string
	readonly testId?: string
}

function multitextParts(raw: string): string[] {
	const parts = raw.split(",")
	return parts.length > 0 ? parts : [""]
}

function heightCmDisplay(raw: string): string {
	const t = raw.trim()
	if (t.length === 0) return ""
	try {
		const v = parseTraitValue("height", t)
		if (v.kind === "height") return String(v.cm)
	} catch {
		/* invalid stored raw */
	}
	return ""
}

function weightKgDisplay(raw: string): string {
	const t = raw.trim()
	if (t.length === 0) return ""
	try {
		const v = parseTraitValue("weight", t)
		if (v.kind === "weight") return String(v.kg)
	} catch {
		/* invalid stored raw */
	}
	return ""
}

function numberDisplay(raw: string): string {
	const t = raw.trim()
	if (t.length === 0) return ""
	try {
		parseTraitValue("number", t)
		return t
	} catch {
		return ""
	}
}

type DateParts = {
	prefix: string
	sign: "+" | "-"
	year: string
	month: string
	day: string
}

function emptyDateParts(): DateParts {
	return { prefix: "", sign: "+", year: "", month: "", day: "" }
}

function parseDateParts(raw: string): DateParts {
	if (raw.trim().length === 0) return emptyDateParts()
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return emptyDateParts()
	}
	if (parsed === null || typeof parsed !== "object") return emptyDateParts()
	const obj = parsed as Record<string, unknown>
	const prefix = typeof obj.p === "string" ? obj.p : ""
	const sign = obj.s === "-" ? "-" : "+"
	const year = typeof obj.y === "number" && obj.y > 0 ? String(obj.y) : ""
	const month = typeof obj.m === "number" && obj.m > 0 ? String(obj.m) : ""
	const day = typeof obj.d === "number" && obj.d > 0 ? String(obj.d) : ""
	return { prefix, sign, year, month, day }
}

function formatDateRaw(parts: DateParts): string {
	const year = parts.year.trim()
	const month = parts.month.trim()
	const day = parts.day.trim()
	const parsedY = year.length > 0 ? Number.parseInt(year, 10) : NaN
	const parsedM = month.length > 0 ? Number.parseInt(month, 10) : NaN
	const parsedD = day.length > 0 ? Number.parseInt(day, 10) : NaN
	// Positive integers only; 0 and negatives are treated as blank.
	const y = Number.isFinite(parsedY) && parsedY > 0 ? parsedY : NaN
	const m = Number.isFinite(parsedM) && parsedM > 0 ? parsedM : NaN
	const d = Number.isFinite(parsedD) && parsedD > 0 ? parsedD : NaN
	// When every field is cleared we still keep the sign (and optional prefix)
	// alive so the user can edit the era/calendar and toggle before/after
	// without the trait row disappearing.
	const payload: Record<string, unknown> = { s: parts.sign }
	if (Number.isFinite(y)) payload.y = y
	if (Number.isFinite(m)) payload.m = m
	if (Number.isFinite(d)) payload.d = d
	if (parts.prefix.trim().length > 0) {
		payload.p = parts.prefix
	}
	return JSON.stringify(payload)
}

export function TraitValueField(props: TraitValueFieldProps) {
	const { kind, value, onChange, placeholder, testId } = props

	if (kind === "text") {
		return (
			<Input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				size="sm"
				className="flex-1 min-w-40"
				placeholder={placeholder}
				maxLength={MAX_NAME_LENGTH}
				data-testid={testId}
			/>
		)
	}

	if (kind === "multitext") {
		const parts = multitextParts(value)
		return (
			<div
				className="flex flex-1 min-w-40 flex-row flex-wrap items-center gap-1"
				data-testid={testId}
			>
				{parts.map((part, index) => (
					<Input
						key={index}
						type="text"
						value={part}
						onChange={(e) => {
							const next = [...parts]
							next[index] = e.target.value
							onChange(next.join(","))
						}}
						size="sm"
						className="min-w-24 flex-1"
						placeholder={placeholder}
						maxLength={MAX_NAME_LENGTH}
					/>
				))}
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-8 shrink-0"
					onClick={() => onChange([...parts, ""].join(","))}
					aria-label="Add field"
				>
					<Add className="size-4" />
				</Button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-8 shrink-0"
					onClick={() => {
						if (parts.length <= 1) {
							onChange("")
							return
						}
						onChange(parts.slice(0, -1).join(","))
					}}
					aria-label="Remove field"
				>
					<MinusSquare className="size-4" />
				</Button>
			</div>
		)
	}

	if (kind === "number") {
		const shown = numberDisplay(value)
		const num =
			shown.length > 0
				? Number.parseFloat(shown.endsWith("+") ? shown.slice(0, -1) : shown)
				: NaN
		return (
			<Input
				type="number"
				step="any"
				value={Number.isFinite(num) ? num : ""}
				onChange={(e) => {
					const v = e.target.value
					if (v === "") {
						onChange("")
						return
					}
					const parsed = Number.parseFloat(v)
					if (!Number.isFinite(parsed)) return
					onChange(String(parsed))
				}}
				size="sm"
				className="flex-1 min-w-40"
				placeholder={placeholder}
				data-testid={testId}
			/>
		)
	}

	if (kind === "height") {
		const cmStr = heightCmDisplay(value)
		const cmNum = cmStr.length > 0 ? Number.parseFloat(cmStr) : Number.NaN
		return (
			<div
				className="flex flex-1 min-w-40 items-center gap-1"
				data-testid={testId}
			>
				<Input
					type="number"
					step="any"
					value={Number.isFinite(cmNum) ? cmNum : ""}
					onChange={(e) => {
						const v = e.target.value
						if (v === "") {
							onChange("")
							return
						}
						const parsed = Number.parseFloat(v)
						if (!Number.isFinite(parsed)) return
						onChange(`${parsed}cm`)
					}}
					size="sm"
					className="min-w-24 flex-1"
					placeholder={placeholder}
				/>
				<span className="shrink-0 text-sm text-muted-foreground">cm</span>
			</div>
		)
	}

	if (kind === "weight") {
		const kgStr = weightKgDisplay(value)
		const kgNum = kgStr.length > 0 ? Number.parseFloat(kgStr) : Number.NaN
		return (
			<div
				className="flex flex-1 min-w-40 items-center gap-1"
				data-testid={testId}
			>
				<Input
					type="number"
					step="any"
					value={Number.isFinite(kgNum) ? kgNum : ""}
					onChange={(e) => {
						const v = e.target.value
						if (v === "") {
							onChange("")
							return
						}
						const parsed = Number.parseFloat(v)
						if (!Number.isFinite(parsed)) return
						onChange(`${parsed}kg`)
					}}
					size="sm"
					className="min-w-24 flex-1"
					placeholder={placeholder}
				/>
				<span className="shrink-0 text-sm text-muted-foreground">kg</span>
			</div>
		)
	}

	if (kind === "date") {
		const { t } = useTranslation()
		const parts = parseDateParts(value)
		function update(next: Partial<DateParts>) {
			onChange(formatDateRaw({ ...parts, ...next }))
		}
		return (
			<div
				className="flex flex-1 min-w-40 flex-wrap items-center gap-1"
				data-testid={testId}
			>
				<Input
					type="text"
					value={parts.prefix}
					onChange={(e) => update({ prefix: e.target.value })}
					size="sm"
					className="min-w-20 flex-1"
					placeholder={t("traits.values.date.prefixPlaceholder")}
					maxLength={MAX_NAME_LENGTH}
				/>
				<PillTabs
					value={parts.sign}
					onChange={(next) => {
						if (next === "+" || next === "-") update({ sign: next })
					}}
					className="shrink-0"
					items={[
						{
							value: "-",
							label: t("traits.values.date.before"),
							ariaLabel: "before",
						},
						{
							value: "+",
							label: t("traits.values.date.after"),
							ariaLabel: "after",
						},
					]}
				/>
				<Input
					type="number"
					value={parts.year}
					onChange={(e) => update({ year: e.target.value })}
					size="sm"
					className="min-w-16 w-20"
					placeholder={t("traits.values.date.year")}
				/>
				<span className="shrink-0 text-sm text-muted-foreground">-</span>
				<Input
					type="number"
					value={parts.month}
					onChange={(e) => update({ month: e.target.value })}
					size="sm"
					className="min-w-12 w-16"
					placeholder={t("traits.values.date.month")}
				/>
				<span className="shrink-0 text-sm text-muted-foreground">-</span>
				<Input
					type="number"
					value={parts.day}
					onChange={(e) => update({ day: e.target.value })}
					size="sm"
					className="min-w-12 w-16"
					placeholder={t("traits.values.date.day")}
				/>
			</div>
		)
	}

	return null
}
