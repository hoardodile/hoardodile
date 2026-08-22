/** Generic message shown when the server cannot be reached. */
export const SERVER_ERROR_MESSAGE =
	"The server could not be reached. It may still be starting, or it may have stopped. Wait a moment and press Retry, or use Restart server from the tray."

/** Dev-specific message: the window lost the Vite dev server, not the sidecar. */
export const DEV_SERVER_ERROR_MESSAGE =
	"The development server is not running. Start `pnpm dev` in another terminal, then press Retry."

/** Loading-page copy. */
export const CONNECTING_MESSAGE = "Connecting…"

// ── Shared static page shell ──────────────────────────────────────────────────
// Mirrors the SPA caption bar (`packages/ui/src/components/caption-bar.tsx`)
// and the Mono palette tokens (`packages/ui/src/styles/theme.css`) so the
// error/loading pages read as part of the app: caption strip, drag region,
// window controls, and no themed borders anywhere.

const CAPTION_CSS = `
.caption { display: flex; align-items: stretch; height: 38px; background: var(--bg); color: var(--fg); user-select: none; }
.caption .group { display: flex; flex-shrink: 0; -webkit-app-region: no-drag; }
.caption button {
	width: 46px; height: 38px; display: flex; align-items: center; justify-content: center;
	border: 0; background: transparent; color: var(--sec); cursor: pointer;
	outline: none;
}
.caption button:hover:not(:disabled) { background: var(--muted); color: var(--fg); }
.caption button:disabled { color: var(--muted-fg); cursor: default; pointer-events: none; }
.caption button.close:hover { background: #c42b1c; color: #fff; }
.caption .drag { flex: 1; min-width: 0; -webkit-app-region: drag; }
`

const CAPTION_HTML = `<div class="caption">
	<div class="group">
		<button id="btn-back" type="button" aria-label="Back" disabled>
			<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5 8l5 4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
		</button>
		<button id="btn-forward" type="button" aria-label="Forward" disabled>
			<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L11 8l-5 4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
		</button>
		<button id="btn-reload" type="button" aria-label="Reload">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M3.67981 13L3.67981 11.3333C3.67981 6.73096 7.4402 3 12.0789 3C15.1178 3 17.7799 4.60136 19.2545 7M2 11.3333L3.67981 13L5.35962 11.3333"/>
				<path d="M20.3139 11V12.6667C20.3139 17.269 16.5391 21 11.8827 21C8.83213 21 6.15995 19.3986 4.67969 17M22.0001 12.6667L20.3139 11L18.6277 12.6667"/>
			</svg>
		</button>
	</div>
	<div class="drag" id="drag"></div>
	<div class="group">
		<button id="btn-min" type="button" aria-label="Minimize">
			<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" fill="none" stroke="currentColor" stroke-width="1"/></svg>
		</button>
		<button id="btn-max" type="button" aria-label="Maximize">
			<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>
		</button>
		<button id="btn-restore" type="button" aria-label="Restore" style="display:none">
			<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M0.5 2.5h7v7h-7z" fill="none" stroke="currentColor" stroke-width="1"/></svg>
		</button>
		<button id="btn-close" class="close" type="button" aria-label="Close">
			<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" fill="none" stroke="currentColor" stroke-width="1"/></svg>
		</button>
	</div>
</div>`

const CAPTION_SCRIPT = `
(function () {
	var bridge = window.hoardodileDesktop;
	function $ (id) { return document.getElementById(id); }
	window.addEventListener("load", function () {
		var el = document.activeElement;
		if (el && typeof el.blur === "function") el.blur();
	});
	$("btn-reload").addEventListener("click", function () {
		if (bridge) bridge.retryLoad(); else window.location.reload();
	});
	// Double-click on the drag region toggles maximize natively on Windows;
	// a JS handler here would double-toggle (native + JS) and leave the
	// window stuck maximized.
	if (bridge) {
		$("btn-min").addEventListener("click", function () { bridge.minimize(); });
		$("btn-max").addEventListener("click", function () { bridge.toggleMaximize(); });
		$("btn-close").addEventListener("click", function () { bridge.close(); });
		function syncMax(max) {
			$("btn-max").style.display = max ? "none" : "";
			$("btn-restore").style.display = max ? "" : "none";
		}
		if (typeof bridge.isMaximized === "function") {
			bridge.isMaximized().then(syncMax);
			if (typeof bridge.onMaximizedChange === "function") {
				bridge.onMaximizedChange(syncMax);
			}
		}
	}
})();
`

const SPINNER_CSS = `
.spin {
	width: 26px; height: 26px; border-radius: 50%;
	border: 2px solid var(--muted-fg); border-top-color: var(--fg);
	animation: hd-spin 0.8s linear infinite;
}
@keyframes hd-spin { to { transform: rotate(360deg); } }
`

function pageCss(): string {
	return `
:root {
	--bg: #fbfbfb; --fg: #101010; --sec: #4a4a48; --muted: #f1f0f1; --muted-fg: #9a9a96;
}
@media (prefers-color-scheme: dark) {
	:root {
		--bg: oklch(0.12 0 0); --fg: oklch(0.96 0 0); --sec: oklch(0.95 0 0);
		--muted: oklch(0.18 0 0); --muted-fg: oklch(0.65 0 0);
	}
}
html, body { height: 100%; margin: 0; }
body {
	display: flex; flex-direction: column;
	font-family: system-ui, -apple-system, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
	background: var(--bg); color: var(--fg);
}
${CAPTION_CSS}${SPINNER_CSS}
.center { flex: 1; display: flex; align-items: center; justify-content: center; }
.status {
	display: flex; flex-direction: column; align-items: center; gap: 12px;
	text-align: center; max-width: 460px; padding: 24px;
}
.status h1 { margin: 0; font-size: 17px; font-weight: 600; }
.status p { margin: 0; font-size: 13px; line-height: 1.7; color: var(--muted-fg); }
.status button {
	font-size: 14px; font-weight: 500; padding: 9px 26px; border: 0; border-radius: 8px;
	background: var(--fg); color: var(--bg); cursor: pointer; outline: none;
}
.status button:hover:not(:disabled) { opacity: 0.88; }
.status button:disabled { opacity: 0.7; cursor: default; }
`
}

function pageDoc(bodyHtml: string, script: string): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>hoardodile</title><style>${pageCss()}</style></head>
<body>${CAPTION_HTML}<div class="center">${bodyHtml}</div>
<script>${CAPTION_SCRIPT}${script}</script>
</body></html>`
}

/** The preload bridge is still installed on this page (data: URL + preload). */
function toDataUrl(html: string): string {
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * Loading page: caption bar plus a centered spinner, shown while the shell
 * (re)loads the app URL so the window is never a blank white canvas.
 */
export function windowLoadingPageUrl(message = CONNECTING_MESSAGE): string {
	const html = pageDoc(
		`<div class="status"><div class="spin" role="progressbar" aria-label="Loading"></div><p>${escapeHtml(message)}</p></div>`,
		"",
	)
	return toDataUrl(html)
}

/**
 * Error page: caption bar plus a centered Retry button. Clicking Retry
 * disables the button (it stays a plain button — the big spinner of the
 * loading page takes over as soon as the shell processes the request) and
 * asks the main process to re-resolve the app URL (Vite in dev, sidecar
 * otherwise).
 */
export function windowErrorPageUrl(message: string): string {
	const html = pageDoc(
		`<div class="status"><h1>Server unreachable</h1><p>${escapeHtml(message)}</p><button id="retry" type="button">Retry</button></div>`,
		`
(function () {
	var button = document.getElementById("retry");
	button.addEventListener("click", function () {
		button.disabled = true;
		var bridge = window.hoardodileDesktop;
		if (bridge) bridge.retryLoad();
	});
})();
`,
	)
	return toDataUrl(html)
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}
