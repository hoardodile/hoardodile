import { LOCAL_TIME_ZONE_SENTINEL } from "@hoardodile/schemas/timezone"
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@hoardodile/ui/components/combobox"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { useMemo, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { getBrowserTimeZone, subscribeBrowserTimeZone } from "@/lib/timezone"
import { getTimeZoneOptions, type TimeZoneOption } from "@/lib/timezones"
import {
	DATE_FORMAT_PRESETS,
	type DateFormatPreset,
	DEFAULT_DATE_FORMAT,
	useDatePrefs,
} from "./datePrefs"

/**
 * Settings panel for choosing the global date/time display format and
 * timezone. Both preferences are persisted via prefSync so they survive
 * reloads and sync to the server.
 */
export function DateTimeSettingsPanel() {
	const { t } = useTranslation()
	const { dateFormat, setDateFormat, timeZone, setTimeZone } = useDatePrefs()
	const browserZone = useSyncExternalStore(
		subscribeBrowserTimeZone,
		getBrowserTimeZone,
		getBrowserTimeZone,
	)

	const timeZoneItems = useMemo(
		() => buildTimeZoneItems(browserZone, t("dateTime.timeZone.auto")),
		[browserZone, t],
	)
	const selectedTimeZone =
		timeZoneItems.find((item) => item.value === timeZone) ?? null

	function handleFormatChange(next: string) {
		if (isDateFormatPreset(next)) setDateFormat(next)
	}

	function handleTimeZoneChange(next: TimeZoneOption | null) {
		if (next !== null) setTimeZone(next.value)
	}

	return (
		// The two selects always stack (the timezone combobox is too wide
		// to share a line with the format select); the owning section still
		// keeps its single-line header + controls row.
		<div className="flex flex-col items-start gap-3">
			<span className="flex flex-col gap-1.5">
				<span className="text-tiny text-muted-foreground">
					{t("dateTime.formatLabel")}
				</span>
				<DropdownSelect
					value={dateFormat}
					onValueChange={handleFormatChange}
					options={DATE_FORMAT_PRESETS.map((preset) => ({
						value: preset.value,
						label: t(preset.labelKey),
					}))}
					placeholder={t("dateTime.formatLabel")}
					aria-label={t("dateTime.formatLabel")}
					data-testid="date-format-select"
				/>
			</span>
			<span className="flex flex-col gap-1.5">
				<span className="text-tiny text-muted-foreground">
					{t("dateTime.timeZoneLabel")}
				</span>
				<Combobox
					items={timeZoneItems}
					value={selectedTimeZone}
					onValueChange={handleTimeZoneChange}
					isItemEqualToValue={(a, b) => a.value === b.value}
				>
					{/* The select-stub anatomy: muted
					    rounded-lg fill with the trailing chevron, keeping the
					    combobox's type-to-search over the long IANA list. The
					    input-group focus ring is suppressed (`!`) so the
					    control matches a plain select. */}
					<ComboboxInput
						className="h-control rounded-lg border-0 bg-muted shadow-none dark:bg-muted has-[[data-slot=input-group-control]:focus-visible]:ring-0! has-[[data-slot=input-group-control]:focus-visible]:border-transparent!"
						placeholder={t("dateTime.timeZoneLabel")}
						aria-label={t("dateTime.timeZoneLabel")}
						data-testid="time-zone-select"
					/>
					<ComboboxContent>
						<ComboboxEmpty>{t("dateTime.timeZone.noMatches")}</ComboboxEmpty>
						<ComboboxList>
							{(item: TimeZoneOption) => (
								<ComboboxItem key={item.value} value={item}>
									{item.label}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</span>
		</div>
	)
}

/**
 * Time-zone options for the combobox: the `"local"` sentinel first (labeled
 * with the current browser zone), then `UTC`, then the browser zone itself,
 * followed by the full searchable IANA list without duplicates.
 */
function buildTimeZoneItems(
	browserZone: string,
	autoLabel: string,
): readonly TimeZoneOption[] {
	const pinned: TimeZoneOption[] = [
		{
			value: LOCAL_TIME_ZONE_SENTINEL,
			label: `${autoLabel} (${browserZone})`,
		},
		{ value: "UTC", label: "UTC" },
	]
	if (browserZone !== "UTC") {
		const browserOption = getTimeZoneOptions().find(
			(option) => option.value === browserZone,
		)
		pinned.push(browserOption ?? { value: browserZone, label: browserZone })
	}
	const pinnedValues = new Set(pinned.map((option) => option.value))
	return [
		...pinned,
		...getTimeZoneOptions().filter((option) => !pinnedValues.has(option.value)),
	]
}

function isDateFormatPreset(value: string): value is DateFormatPreset {
	for (const preset of DATE_FORMAT_PRESETS) {
		if (preset.value === value) return true
	}
	return value === DEFAULT_DATE_FORMAT
}
