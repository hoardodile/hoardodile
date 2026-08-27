import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ExternalLink } from "@/components/common/ExternalLink"

/**
 * Minimal markdown styling — the repo has no typography plugin, so the
 * document uses targeted descendant classes on the wrapper.
 */
const MARKDOWN_CLASSES = [
	"min-w-0 text-sm leading-6 text-foreground",
	"[&_*:first-child]:mt-0",
	"[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground",
	"[&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground",
	"[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground",
	"[&_p]:my-2",
	"[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4",
	"[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4",
	"[&_li]:my-0.5",
	"[&_a]:underline [&_a]:underline-offset-2",
	"[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3",
	"[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
	"[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs",
	"[&_pre_code]:bg-transparent [&_pre_code]:p-0",
	"[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
	"[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
	"[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
	"[&_hr]:my-3 [&_hr]:border-border",
	"[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md",
].join(" ")

/**
 * Resolve a markdown link for outbound clicks: absolute URLs pass through,
 * `#` anchors stay in the document, relative paths resolve against the
 * plugin's GitHub repo page.
 */
function resolveLinkHref(href: string, repo: string): string {
	if (href.startsWith("http://") || href.startsWith("https://")) return href
	if (href.startsWith("#")) return href
	return `https://github.com/${repo}/${href.replace(/^\//, "")}`
}

/** Resolve a markdown image: absolute/data URIs pass through, relative
    paths resolve against the repo root on `raw.githubusercontent.com`. */
function resolveImageSrc(src: string, repo: string): string {
	if (
		src.startsWith("http://") ||
		src.startsWith("https://") ||
		src.startsWith("data:")
	) {
		return src
	}
	return `https://raw.githubusercontent.com/${repo}/HEAD/${src.replace(/^\//, "")}`
}

/**
 * Render plugin-supplied markdown (release intros, repo READMEs). Raw HTML
 * is intentionally NOT parsed (no rehype-raw) — markdown only, so remote
 * content can never inject elements. Links go through {@link ExternalLink}
 * so the desktop shell opens them in the OS browser.
 */
export function PluginMarkdown(props: {
	readonly repo: string
	readonly markdown: string
}) {
	const { repo, markdown } = props
	return (
		<div className={MARKDOWN_CLASSES}>
			<Markdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ node: _node, href, children, ...rest }) => {
						const target = href ?? ""
						if (target.startsWith("#")) {
							return (
								<a href={target} {...rest}>
									{children}
								</a>
							)
						}
						return (
							<ExternalLink href={resolveLinkHref(target, repo)} {...rest}>
								{children}
							</ExternalLink>
						)
					},
					img: ({ node: _node, src, alt, ...rest }) => (
						<img
							src={resolveImageSrc(src ?? "", repo)}
							alt={alt}
							loading="lazy"
							{...rest}
						/>
					),
				}}
			>
				{markdown}
			</Markdown>
		</div>
	)
}
