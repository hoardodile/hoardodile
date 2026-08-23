import { createPluginTranslation } from "@hoardodile/sdk-react"

export const { useTranslation } = createPluginTranslation({
	en: {
		loading: "Loading PDF…",
		error: "Could not open this PDF.",
		errorDetail: "The file could not be fetched or parsed.",
		renderError: "This page could not be rendered.",
		download: "Download",
		pageOf: "of",
		previousPage: "Previous page",
		nextPage: "Next page",
	},
	zh: {
		loading: "正在加载 PDF…",
		error: "无法打开此 PDF。",
		errorDetail: "文件无法获取或解析。",
		renderError: "此页渲染失败。",
		download: "下载",
		pageOf: "/",
		previousPage: "上一页",
		nextPage: "下一页",
	},
})
