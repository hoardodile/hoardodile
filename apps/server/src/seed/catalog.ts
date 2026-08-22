/**
 * Official demo-library catalog. Commons media titles are re-checked at
 * download time. Every user-visible string is tagged with a single language.
 */

import { assertMonolingual, type Copy, type SeedLang } from "./lang.ts"

export const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"
export const FILE_PLUGIN_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

/** Gallery plugin pin on Settings → Plugins. */
export const galleryPluginPin = {
	pinned: true,
	color: "#6366f1",
} as const

type PinStyle = {
	readonly pinned?: boolean
	readonly color?: string
}

export type LicenseFamily = "pd" | "cc0" | "cc-by" | "cc-by-sa"

export type MediaKind = "still" | "animation" | "video" | "audio" | "avatar"

export type GalleryFacet = "image" | "animation" | "video" | "audio"

export type CommonsMedia = {
	readonly title: string
	readonly kind: MediaKind
	readonly expectedLicenseFamily: LicenseFamily
}

export type CatDef = PinStyle & {
	readonly kind: "common" | "resource" | "character"
	readonly name: Copy
	readonly intro: Copy
}

export type TagDef = PinStyle & {
	readonly cat: keyof typeof cats
	readonly name: Copy
	readonly intro: Copy
}

export type TraitDef = PinStyle & {
	readonly kind: "text" | "height" | "weight" | "date"
	readonly name: Copy
	readonly intro: Copy
}

export type CharDef = {
	readonly name: Copy
	readonly intro: Copy
	readonly avatar: CommonsMedia
	readonly fullbody?: CommonsMedia
	readonly tagKeys: readonly (keyof typeof tags)[]
	readonly traits: {
		readonly occupation?: Copy
		readonly height?: string
		readonly weight?: string
		readonly birthday?: {
			readonly y: number
			readonly m: number
			readonly d: number
		}
	}
}

export type ResourceDef = {
	readonly facet: GalleryFacet
	readonly name: Copy
	readonly intro: Copy
	readonly sourceName: Copy
	readonly files: readonly CommonsMedia[]
	readonly tagKeys: readonly (keyof typeof tags)[]
	readonly charKeys: readonly (keyof typeof chars)[]
}

export type CollectionDef = PinStyle & {
	readonly name: Copy
	readonly intro: Copy
	readonly resourceKeys: readonly (keyof typeof resources)[]
}

export type LocalTextFile = {
	readonly filename: string
	readonly body: Copy
}

export type FileResourceDef = {
	readonly name: Copy
	readonly intro: Copy
	readonly files: readonly LocalTextFile[]
	readonly tagKeys: readonly (keyof typeof tags)[]
	readonly trash?: boolean
}

export type CommentDef = {
	readonly body: Copy
	readonly resKey?: keyof typeof resources
	readonly charKey?: keyof typeof chars
	readonly replyTo?: number
}

function copy(lang: SeedLang, text: string): Copy {
	return { lang, text }
}

function commons(
	title: string,
	kind: MediaKind,
	expectedLicenseFamily: LicenseFamily = "pd",
): CommonsMedia {
	return { title, kind, expectedLicenseFamily }
}

const STILL_HUDDLE = commons(
	"File:NASA-HS201427a-HubbleUltraDeepField2014-20140603.jpg",
	"still",
)
const STILL_MARBLE = commons("File:The Blue Marble.jpg", "still")
const STILL_EARTHRISE = commons(
	"File:NASA-Apollo8-Dec24-Earthrise.jpg",
	"still",
)
const STILL_NGC4414 = commons("File:NGC 4414 (NASA-med).jpg", "still")
const STILL_NGC6050 = commons(
	"File:Hubble Interacting Galaxy NGC 6050 (2008-04-24).jpg",
	"still",
)
const STILL_STARRY = commons(
	"File:Van Gogh - Starry Night - Google Art Project.jpg",
	"still",
)
const ANIM_GRACE = commons("File:GRACE globe animation.gif", "animation")
const ANIM_BOYLE = commons("File:Boyles Law animated.gif", "animation")
const AUDIO_APOLLO = commons("File:Apollo 8 liftoff.ogg", "audio")
const VIDEO_NICER = commons(
	"File:NASA'S NICER Does the Space Station Twist (svs13031 crop).webm",
	"video",
)
const VIDEO_JUNO = commons(
	"File:Juno's Perijove-11 Jupiter Flyby, Reconstructed in 125-Fold Time-Lapse, Preliminary.webm",
	"video",
)
const AVATAR_PEARL = commons("File:Girl with a Pearl Earring.jpg", "avatar")
const AVATAR_ALDRIN = commons("File:Aldrin Apollo 11.jpg", "avatar")
const AVATAR_ARMSTRONG = commons("File:Neil A. Armstrong.jpg", "avatar")
const AVATAR_WANDERER = commons(
	"File:Caspar David Friedrich - Wanderer above the sea of fog.jpg",
	"avatar",
)
const STILL_PILLARS = commons("File:Eagle nebula pillars.jpg", "still")
const STILL_HELIX = commons(
	"File:Iridescent Glory of Nearby Helix Nebula.jpg",
	"still",
)
const STILL_SATURN = commons("File:Saturn during Equinox.jpg", "still")
const STILL_ALDRIN_MOON = commons("File:AldrinOnMoon.jpg", "still")
const STILL_BOOTPRINT = commons("File:Apollo 11 bootprint.jpg", "still")
const STILL_MONA = commons(
	"File:Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg",
	"still",
)
const STILL_VENUS = commons("File:Birth of Venus.jpg", "still")
const STILL_MILKMAID = commons(
	"File:Johannes Vermeer - Het melkmeisje - Google Art Project.jpg",
	"still",
)
const STILL_IMPRESSION = commons(
	"File:Claude Monet, Impression, soleil levant.jpg",
	"still",
)
const STILL_HARE = commons("File:Durer Young Hare.jpg", "still")
const STILL_CAT = commons(
	"File:Pierre-Auguste Renoir - Sleeping Cat.jpg",
	"still",
)
const AVATAR_GOGH = commons(
	"File:Vincent van Gogh - Self-Portrait - Google Art Project.jpg",
	"avatar",
)
const AVATAR_LEO = commons("File:Leonardo self.jpg", "avatar")
const AVATAR_CLAIRE = commons(
	"File:Self-portrait in a Straw Hat by Elisabeth-Louise Vigée-Lebrun.jpg",
	"avatar",
)
const AVATAR_YUKI = commons(
	"File:Memorial Portrait of Hiroshige, by Kunisada.jpg",
	"avatar",
)

export const cats = {
	media: {
		kind: "resource",
		name: copy("zh", "媒介"),
		intro: copy("zh", "按内容形态归类的资源命名空间。"),
	},
	genre: {
		kind: "common",
		name: copy("en", "Genre"),
		intro: copy("en", "Shared topical labels for resources and characters."),
		pinned: true,
		color: "#3b82f6",
	},
	place: {
		kind: "resource",
		name: copy("ja", "場所"),
		intro: copy("ja", "作品の舞台や撮影地。"),
	},
	people: {
		kind: "character",
		name: copy("zh", "人物"),
		intro: copy("zh", "角色相关标签。"),
	},
} as const satisfies Record<string, CatDef>

export const tags = {
	landscape: {
		cat: "genre",
		name: copy("en", "landscape"),
		intro: copy("en", "Wide views of land, sea, or sky."),
		pinned: true,
		color: "#22c55e",
	},
	sceneryZh: {
		cat: "media",
		name: copy("zh", "风景"),
		intro: copy("zh", "自然或城市的开阔景象。"),
	},
	paysage: {
		cat: "genre",
		name: copy("fr", "paysage"),
		intro: copy("fr", "Vues ouvertes de la terre, de la mer ou du ciel."),
	},
	space: {
		cat: "genre",
		name: copy("en", "space"),
		intro: copy("en", "Astronomical subjects and missions."),
	},
	cosmosZh: {
		cat: "media",
		name: copy("zh", "宇宙"),
		intro: copy("zh", "天体、深空与航天任务。"),
	},
	galaxyJa: {
		cat: "place",
		name: copy("ja", "銀河"),
		intro: copy("ja", "銀河や星雲の撮影地。"),
	},
	natur: {
		cat: "genre",
		name: copy("de", "Natur"),
		intro: copy("de", "Naturmotive und Landschaft."),
	},
	paisaje: {
		cat: "genre",
		name: copy("es", "paisaje"),
		intro: copy("es", "Vistas abiertas de tierra, mar o cielo."),
	},
	spaceKo: {
		cat: "genre",
		name: copy("ko", "우주"),
		intro: copy("ko", "천체와 우주 탐사."),
	},
	animal: {
		cat: "media",
		name: copy("zh", "动物"),
		intro: copy("zh", "动物主题的上级标签。"),
	},
	cat: {
		cat: "media",
		name: copy("zh", "猫"),
		intro: copy("zh", "猫科动物。"),
	},
	animation: {
		cat: "genre",
		name: copy("en", "animation"),
		intro: copy("en", "Moving images and short loops."),
	},
	audioJa: {
		cat: "media",
		name: copy("ja", "音声"),
		intro: copy("ja", "録音と放送。"),
	},
	explorer: {
		cat: "people",
		name: copy("zh", "探险者"),
		intro: copy("zh", "走出熟悉边界的人。"),
		pinned: true,
		color: "#f59e0b",
	},
} as const satisfies Record<string, TagDef>

export const siblingPairs = [
	{ bad: "sceneryZh", good: "landscape" },
	{ bad: "cosmosZh", good: "space" },
] as const satisfies readonly {
	readonly bad: keyof typeof tags
	readonly good: keyof typeof tags
}[]

export const parentRules = [
	{ child: "cat", parent: "animal" },
] as const satisfies readonly {
	readonly child: keyof typeof tags
	readonly parent: keyof typeof tags
}[]

export const traits = {
	occupation: {
		kind: "text",
		name: copy("zh", "职业"),
		intro: copy("zh", "角色从事的工作。"),
		pinned: true,
		color: "#a855f7",
	},
	height: {
		kind: "height",
		name: copy("zh", "身高"),
		intro: copy("zh", "站立时的身高。"),
	},
	weight: {
		kind: "weight",
		name: copy("zh", "体重"),
		intro: copy("zh", "角色的体重。"),
	},
	birthday: {
		kind: "date",
		name: copy("ja", "誕生日"),
		intro: copy("ja", "生まれた日。"),
	},
} as const satisfies Record<string, TraitDef>

export const chars = {
	marie: {
		name: copy("zh", "玛丽"),
		intro: copy("zh", "安静的观察者，喜欢在窗边整理画稿。"),
		avatar: AVATAR_PEARL,
		tagKeys: ["explorer", "paysage"],
		traits: {
			occupation: copy("zh", "画家"),
			height: "163cm",
			weight: "54kg",
			birthday: { y: 1632, m: 4, d: 12 },
		},
	},
	hoshino: {
		name: copy("ja", "星野"),
		intro: copy("ja", "静かな月面を歩くのが好きな記録者。"),
		avatar: AVATAR_ALDRIN,
		fullbody: AVATAR_ALDRIN,
		tagKeys: ["explorer", "spaceKo"],
		traits: {
			occupation: copy("ja", "飛行士"),
			height: "180cm",
			weight: "70kg",
			birthday: { y: 1930, m: 1, d: 20 },
		},
	},
	elena: {
		name: copy("es", "Elena"),
		intro: copy("es", "Colecciona mapas del cielo y camina despacio."),
		avatar: AVATAR_ARMSTRONG,
		tagKeys: ["explorer", "space"],
		traits: {
			occupation: copy("es", "piloto"),
			height: "180cm",
			weight: "75kg",
			birthday: { y: 1930, m: 8, d: 5 },
		},
	},
	hans: {
		name: copy("de", "Hans"),
		intro: copy("de", "Sammelt stille Bilder von Wind und Wellen."),
		avatar: AVATAR_WANDERER,
		tagKeys: ["natur", "paisaje"],
		traits: {
			occupation: copy("de", "Kartograph"),
			height: "176cm",
			weight: "72kg",
			birthday: { y: 1760, m: 10, d: 31 },
		},
	},
	vincent: {
		name: copy("en", "Vincent"),
		intro: copy("en", "Paints the night until the lamps go out."),
		avatar: AVATAR_GOGH,
		tagKeys: ["paysage", "landscape"],
		traits: {
			occupation: copy("en", "painter"),
			height: "170cm",
			weight: "62kg",
			birthday: { y: 1853, m: 3, d: 30 },
		},
	},
	leo: {
		name: copy("zh", "达芬奇"),
		intro: copy("zh", "同时记下机械草图和远处的云。"),
		avatar: AVATAR_LEO,
		tagKeys: ["explorer", "paysage"],
		traits: {
			occupation: copy("zh", "学者"),
			height: "175cm",
			weight: "68kg",
			birthday: { y: 1452, m: 4, d: 15 },
		},
	},
	claire: {
		name: copy("fr", "Claire"),
		intro: copy("fr", "Prépare les couleurs avant le lever du soleil."),
		avatar: AVATAR_CLAIRE,
		tagKeys: ["paysage", "landscape"],
		traits: {
			occupation: copy("fr", "peintre"),
			height: "162cm",
			weight: "53kg",
			birthday: { y: 1755, m: 4, d: 16 },
		},
	},
	yuki: {
		name: copy("ja", "雪"),
		intro: copy("ja", "橋の上から季節の移りを描く。"),
		avatar: AVATAR_YUKI,
		tagKeys: ["explorer", "landscape"],
		traits: {
			occupation: copy("ja", "絵師"),
			height: "158cm",
			weight: "48kg",
			birthday: { y: 1797, m: 1, d: 1 },
		},
	},
} as const satisfies Record<string, CharDef>

export const resources = {
	earthAlbum: {
		facet: "image",
		name: copy("zh", "地球相册"),
		intro: copy("zh", "从深空回望家园：蓝色大理石、地出，以及哈勃超深空。"),
		sourceName: copy("zh", "美国航天局"),
		files: [STILL_MARBLE, STILL_EARTHRISE, STILL_HUDDLE],
		tagKeys: ["cosmosZh", "sceneryZh", "landscape"],
		charKeys: ["marie", "elena"],
	},
	galaxyAlbum: {
		facet: "image",
		name: copy("en", "Nearby galaxies"),
		intro: copy("en", "Two Hubble stills of spiral and interacting galaxies."),
		sourceName: copy("en", "NASA"),
		files: [STILL_NGC4414, STILL_NGC6050],
		tagKeys: ["space", "galaxyJa"],
		charKeys: ["hoshino"],
	},
	starryNight: {
		facet: "image",
		name: copy("fr", "La Nuit étoilée"),
		intro: copy("fr", "Un ciel tourbillonnant au-dessus d'un village endormi."),
		sourceName: copy("fr", "Vincent van Gogh"),
		files: [STILL_STARRY],
		tagKeys: ["paysage", "landscape"],
		charKeys: ["marie"],
	},
	grace: {
		facet: "animation",
		name: copy("zh", "地球重力场"),
		intro: copy("zh", "重力恢复与气候试验任务生成的地球重力模型。"),
		sourceName: copy("zh", "美国航天局"),
		files: [ANIM_GRACE],
		tagKeys: ["animation", "cosmosZh"],
		charKeys: ["elena"],
	},
	boyle: {
		facet: "animation",
		name: copy("en", "Boyle's law"),
		intro: copy(
			"en",
			"A classroom loop of pressure and volume at constant temperature.",
		),
		sourceName: copy("en", "NASA"),
		files: [ANIM_BOYLE],
		tagKeys: ["animation"],
		charKeys: [],
	},
	juno: {
		facet: "video",
		name: copy("en", "Juno at Jupiter"),
		intro: copy(
			"en",
			"A time-lapse of Juno's Perijove-11 flyby reconstructed from JunoCam.",
		),
		sourceName: copy("en", "NASA"),
		files: [VIDEO_JUNO],
		tagKeys: ["space", "galaxyJa"],
		charKeys: ["elena", "hoshino"],
	},
	pillars: {
		facet: "image",
		name: copy("zh", "创生之柱"),
		intro: copy("zh", "鹰状星云里正在形成恒星的气柱。"),
		sourceName: copy("zh", "美国航天局"),
		files: [STILL_PILLARS],
		tagKeys: ["cosmosZh", "galaxyJa"],
		charKeys: ["hoshino", "elena"],
	},
	helix: {
		facet: "image",
		name: copy("en", "Helix Nebula"),
		intro: copy("en", "A nearby planetary nebula seen almost end-on."),
		sourceName: copy("en", "NASA"),
		files: [STILL_HELIX],
		tagKeys: ["space", "galaxyJa"],
		charKeys: ["elena"],
	},
	saturn: {
		facet: "image",
		name: copy("es", "Saturno en equinoccio"),
		intro: copy("es", "Anillos y lunas vistos por la sonda Cassini."),
		sourceName: copy("es", "NASA"),
		files: [STILL_SATURN],
		tagKeys: ["space", "paisaje"],
		charKeys: ["elena", "hoshino"],
	},
	moonwalk: {
		facet: "image",
		name: copy("zh", "月面行走"),
		intro: copy("zh", "阿波罗十一号在静海留下的人与脚印。"),
		sourceName: copy("zh", "美国航天局"),
		files: [STILL_ALDRIN_MOON, STILL_BOOTPRINT],
		tagKeys: ["cosmosZh", "spaceKo"],
		charKeys: ["hoshino", "yuki"],
	},
	monaLisa: {
		facet: "image",
		name: copy("zh", "蒙娜丽莎"),
		intro: copy("zh", "卢浮宫所藏的半身肖像，神情含蓄。"),
		sourceName: copy("zh", "达芬奇"),
		files: [STILL_MONA],
		tagKeys: ["paysage"],
		charKeys: ["leo", "vincent"],
	},
	venus: {
		facet: "image",
		name: copy("fr", "La Naissance de Vénus"),
		intro: copy("fr", "Vénus arrive sur la conque vers le rivage."),
		sourceName: copy("fr", "Sandro Botticelli"),
		files: [STILL_VENUS],
		tagKeys: ["paysage", "landscape"],
		charKeys: ["claire", "marie"],
	},
	milkmaid: {
		facet: "image",
		name: copy("en", "The Milkmaid"),
		intro: copy("en", "A kitchen maid pours milk into a stone bowl."),
		sourceName: copy("en", "Johannes Vermeer"),
		files: [STILL_MILKMAID],
		tagKeys: ["paysage"],
		charKeys: ["marie", "claire"],
	},
	impression: {
		facet: "image",
		name: copy("fr", "Impression, soleil levant"),
		intro: copy("fr", "Le port du Havre dans la brume du matin."),
		sourceName: copy("fr", "Claude Monet"),
		files: [STILL_IMPRESSION],
		tagKeys: ["paysage", "landscape"],
		charKeys: ["claire", "vincent"],
	},
	hare: {
		facet: "image",
		name: copy("de", "Feldhase"),
		intro: copy("de", "Ein sitzender Hase, Haar um Haar gesetzt."),
		sourceName: copy("de", "Albrecht Dürer"),
		files: [STILL_HARE],
		tagKeys: ["animal", "natur"],
		charKeys: ["hans"],
	},
	sleepingCat: {
		facet: "image",
		name: copy("zh", "睡着的猫"),
		intro: copy("zh", "蜷在布上打盹的一只猫。"),
		sourceName: copy("zh", "雷诺阿"),
		files: [STILL_CAT],
		tagKeys: ["cat"],
		charKeys: ["marie", "hans"],
	},
	apolloAudio: {
		facet: "audio",
		name: copy("zh", "阿波罗八号升空"),
		intro: copy("zh", "发射瞬间的电台录音，从点火前到升空后。"),
		sourceName: copy("zh", "美国航天局"),
		files: [AUDIO_APOLLO],
		tagKeys: ["audioJa", "cosmosZh"],
		charKeys: ["hoshino"],
	},
	nicer: {
		facet: "video",
		name: copy("en", "Station twist"),
		intro: copy(
			"en",
			"NASA's NICER payload turns with the International Space Station.",
		),
		sourceName: copy("en", "NASA"),
		files: [VIDEO_NICER],
		tagKeys: ["space"],
		charKeys: ["elena"],
	},
} as const satisfies Record<string, ResourceDef>

export const collections = {
	deepSky: {
		name: copy("zh", "深空档案"),
		intro: copy("zh", "望远镜与探测器带回的远方。"),
		resourceKeys: [
			"earthAlbum",
			"galaxyAlbum",
			"grace",
			"pillars",
			"helix",
			"saturn",
			"moonwalk",
			"nicer",
			"juno",
		],
		pinned: true,
		color: "#0ea5e9",
	},
	shore: {
		name: copy("en", "Shore and sky"),
		intro: copy("en", "Paint and a short classroom loop."),
		resourceKeys: ["starryNight", "boyle"],
	},
	paintings: {
		name: copy("zh", "画廊"),
		intro: copy("zh", "画布上的人、海与晨雾。"),
		resourceKeys: [
			"starryNight",
			"monaLisa",
			"venus",
			"milkmaid",
			"impression",
		],
		pinned: true,
		color: "#f59e0b",
	},
	fauna: {
		name: copy("de", "Tierstudien"),
		intro: copy("de", "Ein Hase und eine schlafende Katze."),
		resourceKeys: ["hare", "sleepingCat"],
	},
} as const satisfies Record<string, CollectionDef>

export const fileResources = {
	licenseNotes: {
		name: copy("zh", "许可备忘"),
		intro: copy("zh", "本库媒体许可的短备忘，不走图库插件。"),
		files: [
			{
				filename: "readme.txt",
				body: copy("zh", "媒体来自维基共享资源与美国航天局，许可为公有领域。"),
			},
			{
				filename: "authors.txt",
				body: copy("zh", "作者与机构名随各资源字段语言书写。"),
			},
		],
		tagKeys: ["cosmosZh"],
	},
	fieldNotes: {
		name: copy("ja", "現地メモ"),
		intro: copy("ja", "観察の短い走り書き。"),
		files: [
			{
				filename: "notes.txt",
				body: copy("ja", "星がよく見える夜だった。"),
			},
		],
		tagKeys: ["landscape"],
	},
	draftScrap: {
		name: copy("en", "Draft scrap"),
		intro: copy("en", "A leftover note moved to trash for the demo."),
		files: [
			{
				filename: "scrap.txt",
				body: copy("en", "Not used in the live library."),
			},
		],
		tagKeys: [],
		trash: true,
	},
} as const satisfies Record<string, FileResourceDef>

export const relationshipType = {
	name: copy("zh", "同行"),
	selfLabel: copy("zh", "同行者"),
	targetLabel: copy("zh", "旅伴"),
	intro: copy("zh", "一起走过一段路的人。"),
	kind: "symmetric" as const,
	pinned: true,
	color: "#e11d48",
	edges: [
		{ self: "marie", target: "hans" },
		{ self: "hoshino", target: "elena" },
		{ self: "vincent", target: "marie" },
		{ self: "claire", target: "elena" },
	] as const satisfies readonly {
		readonly self: keyof typeof chars
		readonly target: keyof typeof chars
	}[],
}

export const hierarchyType = {
	name: copy("zh", "指导"),
	selfLabel: copy("zh", "导师"),
	targetLabel: copy("zh", "学生"),
	intro: copy("zh", "把经验传给下一位的人。"),
	kind: "hierarchical" as const,
	hierarchyFrom: "self" as const,
	edges: [
		{ self: "marie", target: "hoshino" },
		{ self: "leo", target: "vincent" },
	] as const satisfies readonly {
		readonly self: keyof typeof chars
		readonly target: keyof typeof chars
	}[],
}

export const syncDevice = {
	name: copy("zh", "本机"),
	notes: copy("zh", "演示用的第一台记录设备。"),
}

export const comments = [
	{
		body: copy("zh", "这张地出今天看起来格外安静。"),
		resKey: "earthAlbum",
		charKey: "marie",
	},
	{
		body: copy("ja", "月の縁がきれい。"),
		resKey: "earthAlbum",
		charKey: "hoshino",
		replyTo: 0,
	},
	{
		body: copy("fr", "Elle observe encore."),
		charKey: "marie",
	},
	{
		body: copy("en", "The smile holds still under museum light."),
		resKey: "monaLisa",
		charKey: "vincent",
	},
	{
		body: copy("de", "Jedes Haar sitzt."),
		resKey: "hare",
		charKey: "hans",
	},
	{
		body: copy("ja", "足跡が残っている。"),
		resKey: "moonwalk",
		charKey: "yuki",
	},
	{
		body: copy("zh", "这只猫睡得很沉。"),
		resKey: "sleepingCat",
		charKey: "marie",
	},
	{
		body: copy("es", "Los anillos cortan la luz."),
		resKey: "saturn",
		charKey: "elena",
	},
] satisfies readonly CommentDef[]

export const docs = {
	folder: {
		title: copy("zh", "笔记"),
	},
	license: {
		title: copy("zh", "许可说明"),
		lang: "zh" as const,
	},
	notes: {
		title: copy("en", "Field notes"),
		lang: "en" as const,
	},
	walk: {
		title: copy("fr", "Promenade"),
		body: copy("fr", "Une page pour les nouvelles toiles."),
		lang: "fr" as const,
	},
}

/** Every Commons file referenced by the catalog, deduplicated by title. */
export function catalogMedia(): readonly CommonsMedia[] {
	const byTitle = new Map<string, CommonsMedia>()
	function add(media: CommonsMedia): void {
		if (!byTitle.has(media.title)) byTitle.set(media.title, media)
	}
	for (const res of Object.values(resources)) {
		for (const file of res.files) add(file)
	}
	for (const ch of Object.values(chars)) {
		add(ch.avatar)
		if ("fullbody" in ch && ch.fullbody !== undefined) add(ch.fullbody)
	}
	return [...byTitle.values()]
}

/** User-visible copy strings the monolingual test walks. */
export function catalogCopies(): readonly {
	readonly label: string
	readonly copy: Copy
}[] {
	const out: { label: string; copy: Copy }[] = []
	function push(label: string, item: Copy): void {
		out.push({ label, copy: item })
	}
	for (const [key, cat] of Object.entries(cats)) {
		push(`cats.${key}.name`, cat.name)
		push(`cats.${key}.intro`, cat.intro)
	}
	for (const [key, tag] of Object.entries(tags)) {
		push(`tags.${key}.name`, tag.name)
		push(`tags.${key}.intro`, tag.intro)
	}
	for (const [key, trait] of Object.entries(traits)) {
		push(`traits.${key}.name`, trait.name)
		push(`traits.${key}.intro`, trait.intro)
	}
	for (const [key, ch] of Object.entries(chars)) {
		push(`chars.${key}.name`, ch.name)
		push(`chars.${key}.intro`, ch.intro)
		if (ch.traits.occupation !== undefined) {
			push(`chars.${key}.occupation`, ch.traits.occupation)
		}
	}
	for (const [key, res] of Object.entries(resources)) {
		push(`resources.${key}.name`, res.name)
		push(`resources.${key}.intro`, res.intro)
		push(`resources.${key}.sourceName`, res.sourceName)
	}
	for (const [key, col] of Object.entries(collections)) {
		push(`collections.${key}.name`, col.name)
		push(`collections.${key}.intro`, col.intro)
	}
	for (const [key, res] of Object.entries(fileResources)) {
		push(`fileResources.${key}.name`, res.name)
		push(`fileResources.${key}.intro`, res.intro)
		for (const [index, file] of res.files.entries()) {
			push(`fileResources.${key}.files.${index}`, file.body)
		}
	}
	push("relationshipType.name", relationshipType.name)
	push("relationshipType.selfLabel", relationshipType.selfLabel)
	push("relationshipType.targetLabel", relationshipType.targetLabel)
	push("relationshipType.intro", relationshipType.intro)
	push("hierarchyType.name", hierarchyType.name)
	push("hierarchyType.selfLabel", hierarchyType.selfLabel)
	push("hierarchyType.targetLabel", hierarchyType.targetLabel)
	push("hierarchyType.intro", hierarchyType.intro)
	push("syncDevice.name", syncDevice.name)
	push("syncDevice.notes", syncDevice.notes)
	for (const [index, row] of comments.entries()) {
		push(`comments.${index}`, row.body)
	}
	push("docs.folder.title", docs.folder.title)
	push("docs.license.title", docs.license.title)
	push("docs.notes.title", docs.notes.title)
	push("docs.walk.title", docs.walk.title)
	push("docs.walk.body", docs.walk.body)
	return out
}

/** Facets the seeded gallery resources must cover. */
export function catalogFacets(): readonly GalleryFacet[] {
	const found = new Set<GalleryFacet>()
	for (const res of Object.values(resources)) found.add(res.facet)
	return [...found]
}

/** Run the monolingual heuristic over every catalog copy field. */
export function assertCatalogMonolingual(): void {
	for (const row of catalogCopies()) {
		assertMonolingual(row.copy, row.label)
	}
}
