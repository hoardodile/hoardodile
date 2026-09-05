import { usePluginAPI } from "./hooks"
import { useTranslation } from "./i18n"

export function TemplateView() {
	const api = usePluginAPI()
	const { t } = useTranslation()
	const files = api.resource.sourceMeta?.files ?? []
	const hdtplCount = api.resource.sourceMeta?.hdtplCount

	return (
		<div className="flex h-full flex-col gap-3 overflow-auto p-4 font-sans text-sm text-gray-800 dark:text-gray-100">
			<header>
				<h1 className="text-lg font-semibold">{api.resource.name}</h1>
				<p className="text-gray-500 dark:text-gray-400">
					{t("renderedBy")} {t("editHint")}
				</p>
			</header>
			<p>
				{hdtplCount !== undefined
					? t("fileCount", { count: hdtplCount })
					: t("noSourceMeta")}
			</p>
			<ul className="list-inside list-disc">
				{files.map((file) => (
					<li key={file}>{file}</li>
				))}
			</ul>
		</div>
	)
}
