export const danmakuKeys = {
	all: ["danmaku"] as const,
	list: (input: { anchor: { resId: string } }) =>
		[...danmakuKeys.all, "list", input] as const,
} as const
