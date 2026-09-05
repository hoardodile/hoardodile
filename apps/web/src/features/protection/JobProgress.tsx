import { useTranslation } from "react-i18next"
import { z } from "zod"
import { formatBytes } from "@/lib/formatBytes"

const metrics = z.object({
	bytes_done: z.number().optional(),
	bytes_restored: z.number().optional(),
	total_bytes_processed: z.number().optional(),
	files_done: z.number().optional(),
	files_restored: z.number().optional(),
	total_files_processed: z.number().optional(),
	data_added_packed: z.number().optional(),
	networkBytes: z.number().optional(),
})

export function JobProgress({ value }: { value: unknown }) {
	const { t } = useTranslation()
	const parsed = metrics.safeParse(value)
	if (!parsed.success) return null
	const data = parsed.data
	const bytes =
		data.total_bytes_processed ?? data.bytes_done ?? data.bytes_restored
	const files =
		data.total_files_processed ?? data.files_done ?? data.files_restored
	const parts: string[] = []
	if (files !== undefined)
		parts.push(t("protection.processedFiles", { count: files }))
	if (bytes !== undefined)
		parts.push(t("protection.processedBytes", { value: formatBytes(bytes) }))
	if (data.data_added_packed !== undefined)
		parts.push(
			t("protection.addedBytes", {
				value: formatBytes(data.data_added_packed),
			}),
		)
	if (data.networkBytes !== undefined)
		parts.push(
			t("protection.networkBytes", { value: formatBytes(data.networkBytes) }),
		)
	return parts.length ? (
		<p className="mt-1 text-xs text-muted-foreground">{parts.join(" · ")}</p>
	) : null
}
