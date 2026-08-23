import en from "@hoardodile/shared/i18n/en.json"
import zh from "@hoardodile/shared/i18n/zh.json"

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

function pickCatalog(): typeof en {
	if (typeof navigator !== "undefined" && navigator.language.startsWith("zh")) {
		return zh
	}
	return en
}

export function wizardCopy(): WizardCopy {
	const catalog = pickCatalog()
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
	const catalog = pickCatalog()
	return {
		serverUnreachable: catalog.desktopShell.shell.serverUnreachable,
		retry: catalog.desktopShell.shell.retry,
		loadingLabel: catalog.desktopShell.shell.loadingLabel,
	}
}
