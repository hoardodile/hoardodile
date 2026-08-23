import type { SupportedLanguage } from "@hoardodile/shared/i18n"
import { resolveSystemLanguage } from "@hoardodile/shared/i18n"
import { catalogFor } from "@hoardodile/shared/i18n/catalogs"
import type { CaptionHistoryControls } from "@hoardodile/ui/components/caption-bar"

/**
 * Caption history for shell pages and the wizard: back / forward are never
 * allowed to walk away from these flows (the retry page is a dead end by
 * design), while reload re-fetches the current shell page in place.
 */
export const disabledCaptionHistory: CaptionHistoryControls = {
	canGoBack: false,
	canGoForward: false,
	back() {},
	forward() {},
	reload() {
		window.location.reload()
	},
}

export type WizardCopy = {
	readonly title: string
	readonly intro: string
	readonly library: string
	readonly browse: string
	readonly autoStart: string
	readonly autoStartHint: string
	readonly startInTray: string
	readonly startInTrayHint: string
	readonly continue: string
	readonly missingBridge: string
}

export type ShellCopy = {
	readonly serverUnreachable: string
	readonly retry: string
	readonly loadingLabel: string
}

/** The shell's own copy before the SPA pushes a language: detect from the
 *  system locale. */
function pickSystemLanguage(): SupportedLanguage {
	return resolveSystemLanguage(navigator.language)
}

export function wizardCopy(): WizardCopy {
	const catalog = catalogFor(pickSystemLanguage())
	return {
		title: catalog.desktopShell.wizard.title,
		intro: catalog.desktopShell.wizard.intro,
		library: catalog.desktopShell.wizard.library,
		browse: catalog.desktopShell.wizard.browse,
		autoStart: catalog.desktopShell.wizard.autoStart,
		autoStartHint: catalog.desktopShell.wizard.autoStartHint,
		startInTray: catalog.desktopShell.wizard.startInTray,
		startInTrayHint: catalog.desktopShell.wizard.startInTrayHint,
		continue: catalog.desktopShell.wizard.continue,
		missingBridge: catalog.desktopShell.wizard.missingBridge,
	}
}

export function shellCopy(): ShellCopy {
	const catalog = catalogFor(pickSystemLanguage())
	return {
		serverUnreachable: catalog.desktopShell.shell.serverUnreachable,
		retry: catalog.desktopShell.shell.retry,
		loadingLabel: catalog.desktopShell.shell.loadingLabel,
	}
}
