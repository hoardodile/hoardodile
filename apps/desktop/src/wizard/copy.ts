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

const EN: WizardCopy = {
	title: "Welcome to hoardodile",
	intro:
		"Choose where this computer keeps the archive. You can change the folder later from Settings or the tray.",
	library: "Library folder",
	browse: "Browse",
	autoStart: "Start with Windows",
	autoStartHint: "Open hoardodile when you sign in.",
	startInTray: "Start in tray",
	startInTrayHint: "No window until you choose Open from the tray.",
	continue: "Continue",
	missingBridge: "Desktop bridge missing. Restart the app.",
}

const ZH: WizardCopy = {
	title: "欢迎使用 hoardodile",
	intro: "选择这台电脑存放归档的位置。之后可以在设置或托盘里更换文件夹。",
	library: "存储文件夹",
	browse: "浏览",
	autoStart: "开机启动",
	autoStartHint: "登录 Windows 时打开 hoardodile。",
	startInTray: "启动到托盘",
	startInTrayHint: "在托盘中选择打开之前不显示窗口。",
	continue: "继续",
	missingBridge: "桌面桥接不可用。请重启应用。",
}

export function wizardCopy(): WizardCopy {
	if (typeof navigator !== "undefined" && navigator.language.startsWith("zh")) {
		return ZH
	}
	return EN
}
