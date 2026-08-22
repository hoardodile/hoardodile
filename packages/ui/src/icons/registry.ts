/**
 * Central Solar icon registry for the design system.
 *
 * Every Solar glyph the app renders is exported here through `createIcon`
 * from `@hoardodile/ui` — one component per glyph carrying the three
 * parallel Solar weights (bold / boldDuotone / linear). The wrapper picks
 * the glyph for the active icon style preference (Settings → Icons): in
 * `linear` style the boldDuotone glyphs swap to their thin-line linear
 * counterparts; an explicit `mode` prop overrides (`"bold"` for selected
 * states). Every export carries the `hd-icon` hook class so the
 * duotone/grayscale CSS in theme.css applies to direct renders too. All
 * exports are wrapped — never the raw glyphs. Importing Solar directly is
 * confined to this file and @hoardodile/ui internals — consumers import
 * the wrapped exports only.
 *
 * Structure — imports first, one block per Solar weight (bold / bold-duotone /
 * linear, alphabetical by glyph; every glyph has all three), then one
 * export section, alphabetical by name (ordinal, case-sensitive —
 * `BookTone`'s stem `Book` sorts before `Bookmark`):
 *
 *   export const <Name> = createIcon({
 *     bold: <Name>BoldWeight,        — filled, single-color; selected states
 *     boldDuotone: <Name>BoldDuotone, — two-tone, the default
 *     linear: <Name>Linear,          — thin-line; `linear` icon style
 *   })
 *
 * Modes are parallel and mandatory: adding a member to `IconMode` forces
 * every entry to register it (guarded by icons.test.ts). One exception:
 * `MenuDots` maps its `linear` slot to the filled weight — the thin-line
 * dots read as noise at small sizes. Tree-shaking keeps only the variants
 * actually imported.
 */

import { AddCircleIcon as AddCircleBoldWeight } from "@solar-icons/react/bold/add-circle"
import { AlignLeftIcon as AlignLeftBoldWeight } from "@solar-icons/react/bold/align-left"
import { AltArrowDownIcon as AltArrowDownBoldWeight } from "@solar-icons/react/bold/alt-arrow-down"
import { AltArrowLeftIcon as AltArrowLeftBoldWeight } from "@solar-icons/react/bold/alt-arrow-left"
import { AltArrowRightIcon as AltArrowRightBoldWeight } from "@solar-icons/react/bold/alt-arrow-right"
import { AltArrowUpIcon as AltArrowUpBoldWeight } from "@solar-icons/react/bold/alt-arrow-up"
import { ArchiveIcon as ArchiveBoldWeight } from "@solar-icons/react/bold/archive"
import { ArrowRightIcon as ArrowRightBoldWeight } from "@solar-icons/react/bold/arrow-right"
import { ArrowToTopLeftIcon as ArrowToTopLeftBoldWeight } from "@solar-icons/react/bold/arrow-to-top-left"
import { ArrowToTopRightIcon as ArrowToTopRightBoldWeight } from "@solar-icons/react/bold/arrow-to-top-right"
import { BellIcon as BellBoldWeight } from "@solar-icons/react/bold/bell"
import { BoltIcon as BoltBoldWeight } from "@solar-icons/react/bold/bolt"
import { BookIcon as BookBoldWeight } from "@solar-icons/react/bold/book"
import { Book2Icon as Book2BoldWeight } from "@solar-icons/react/bold/book-2"
import { BookmarkIcon as BookmarkBoldWeight } from "@solar-icons/react/bold/bookmark"
import { BookmarkCircleIcon as BookmarkCircleBoldWeight } from "@solar-icons/react/bold/bookmark-circle"
import { BoxIcon as BoxBoldWeight } from "@solar-icons/react/bold/box"
import { BranchingPathsUpIcon as BranchingPathsUpBoldWeight } from "@solar-icons/react/bold/branching-paths-up"
import { CalendarDateIcon as CalendarDateBoldWeight } from "@solar-icons/react/bold/calendar-date"
import { ChatRoundIcon as ChatRoundBoldWeight } from "@solar-icons/react/bold/chat-round"
import { ChatRoundDotsIcon as ChatRoundDotsBoldWeight } from "@solar-icons/react/bold/chat-round-dots"
import { ChatRoundLineIcon as ChatRoundLineBoldWeight } from "@solar-icons/react/bold/chat-round-line"
import { ChatSquareIcon as ChatSquareBoldWeight } from "@solar-icons/react/bold/chat-square"
import { CheckCircleIcon as CheckCircleBoldWeight } from "@solar-icons/react/bold/check-circle"
import { ChecklistIcon as ChecklistBoldWeight } from "@solar-icons/react/bold/checklist"
import { ClipboardListIcon as ClipboardListBoldWeight } from "@solar-icons/react/bold/clipboard-list"
import { ClockCircleIcon as ClockCircleBoldWeight } from "@solar-icons/react/bold/clock-circle"
import { CompassIcon as CompassBoldWeight } from "@solar-icons/react/bold/compass"
import { CopyIcon as CopyBoldWeight } from "@solar-icons/react/bold/copy"
import { CrownIcon as CrownBoldWeight } from "@solar-icons/react/bold/crown"
import { DangerTriangleIcon as DangerTriangleBoldWeight } from "@solar-icons/react/bold/danger-triangle"
import { DatabaseIcon as DatabaseBoldWeight } from "@solar-icons/react/bold/database"
import { DisketteIcon as DisketteBoldWeight } from "@solar-icons/react/bold/diskette"
import { DislikeIcon as DislikeBoldWeight } from "@solar-icons/react/bold/dislike"
import { DocumentAddIcon as DocumentAddBoldWeight } from "@solar-icons/react/bold/document-add"
import { DocumentTextIcon as DocumentTextBoldWeight } from "@solar-icons/react/bold/document-text"
import { DoubleAltArrowDownIcon as DoubleAltArrowDownBoldWeight } from "@solar-icons/react/bold/double-alt-arrow-down"
import { DownloadIcon as DownloadBoldWeight } from "@solar-icons/react/bold/download"
import { EraserIcon as EraserBoldWeight } from "@solar-icons/react/bold/eraser"
import { EyeIcon as EyeBoldWeight } from "@solar-icons/react/bold/eye"
import { FileIcon as FileBoldWeight } from "@solar-icons/react/bold/file"
import { FileRemoveIcon as FileRemoveBoldWeight } from "@solar-icons/react/bold/file-remove"
import { FileTextIcon as FileTextBoldWeight } from "@solar-icons/react/bold/file-text"
import { FilterIcon as FilterBoldWeight } from "@solar-icons/react/bold/filter"
import { FiltersIcon as FiltersBoldWeight } from "@solar-icons/react/bold/filters"
import { FolderIcon as FolderBoldWeight } from "@solar-icons/react/bold/folder"
import { FolderOpenIcon as FolderOpenBoldWeight } from "@solar-icons/react/bold/folder-open"
import { FolderPathConnectIcon as FolderPathConnectBoldWeight } from "@solar-icons/react/bold/folder-path-connect"
import { ForbiddenCircleIcon as ForbiddenCircleBoldWeight } from "@solar-icons/react/bold/forbidden-circle"
import { GalleryIcon as GalleryBoldWeight } from "@solar-icons/react/bold/gallery"
import { GalleryAddIcon as GalleryAddBoldWeight } from "@solar-icons/react/bold/gallery-add"
import { GalleryWideIcon as GalleryWideBoldWeight } from "@solar-icons/react/bold/gallery-wide"
import { GlobalIcon as GlobalBoldWeight } from "@solar-icons/react/bold/global"
import { GraphDownIcon as GraphDownBoldWeight } from "@solar-icons/react/bold/graph-down"
import { GraphUpIcon as GraphUpBoldWeight } from "@solar-icons/react/bold/graph-up"
import { HamburgerMenuIcon as HamburgerMenuBoldWeight } from "@solar-icons/react/bold/hamburger-menu"
import { HandHeartIcon as HandHeartBoldWeight } from "@solar-icons/react/bold/hand-heart"
import { HeartIcon as HeartBoldWeight } from "@solar-icons/react/bold/heart"
import { HelpIcon as HelpBoldWeight } from "@solar-icons/react/bold/help"
import { HistoryIcon as HistoryBoldWeight } from "@solar-icons/react/bold/history"
import { HomeAngleIcon as HomeAngleBoldWeight } from "@solar-icons/react/bold/home-angle"
import { InfoCircleIcon as InfoCircleBoldWeight } from "@solar-icons/react/bold/info-circle"
import { LayersIcon as LayersBoldWeight } from "@solar-icons/react/bold/layers"
import { LetterIcon as LetterBoldWeight } from "@solar-icons/react/bold/letter"
import { LikeIcon as LikeBoldWeight } from "@solar-icons/react/bold/like"
import { LinkIcon as LinkBoldWeight } from "@solar-icons/react/bold/link"
import { ListIcon as ListBoldWeight } from "@solar-icons/react/bold/list"
import { ListVerticalIcon as ListVerticalBoldWeight } from "@solar-icons/react/bold/list-vertical"
import { LockPasswordIcon as LockPasswordBoldWeight } from "@solar-icons/react/bold/lock-password"
import { Login2Icon as Login2BoldWeight } from "@solar-icons/react/bold/login-2"
import { LogoutIcon as LogoutBoldWeight } from "@solar-icons/react/bold/logout"
import { MagicWand2Icon as MagicWand2BoldWeight } from "@solar-icons/react/bold/magic-wand-2"
import { MagnifierIcon as MagnifierBoldWeight } from "@solar-icons/react/bold/magnifier"
import { MagnifierZoomInIcon as MagnifierZoomInBoldWeight } from "@solar-icons/react/bold/magnifier-zoom-in"
import { MagnifierZoomOutIcon as MagnifierZoomOutBoldWeight } from "@solar-icons/react/bold/magnifier-zoom-out"
import { MaximizeIcon as MaximizeBoldWeight } from "@solar-icons/react/bold/maximize"
import { MenuDotsIcon as MenuDotsBoldWeight } from "@solar-icons/react/bold/menu-dots"
import { MinimizeIcon as MinimizeBoldWeight } from "@solar-icons/react/bold/minimize"
import { MinusSquareIcon as MinusSquareBoldWeight } from "@solar-icons/react/bold/minus-square"
import { MonitorIcon as MonitorBoldWeight } from "@solar-icons/react/bold/monitor"
import { MonitorSmartphoneIcon as MonitorSmartphoneBoldWeight } from "@solar-icons/react/bold/monitor-smartphone"
import { MoonIcon as MoonBoldWeight } from "@solar-icons/react/bold/moon"
import { MoveToFolderIcon as MoveToFolderBoldWeight } from "@solar-icons/react/bold/move-to-folder"
import { MusicNotesIcon as MusicNotesBoldWeight } from "@solar-icons/react/bold/music-notes"
import { PaletteIcon as PaletteBoldWeight } from "@solar-icons/react/bold/palette"
import { PaletteRoundIcon as PaletteRoundBoldWeight } from "@solar-icons/react/bold/palette-round"
import { PauseIcon as PauseBoldWeight } from "@solar-icons/react/bold/pause"
import { PenIcon as PenBoldWeight } from "@solar-icons/react/bold/pen"
import { PenNewRoundIcon as PenNewRoundBoldWeight } from "@solar-icons/react/bold/pen-new-round"
import { PieChartIcon as PieChartBoldWeight } from "@solar-icons/react/bold/pie-chart"
import { PinIcon as PinBoldWeight } from "@solar-icons/react/bold/pin"
import { PlayIcon as PlayBoldWeight } from "@solar-icons/react/bold/play"
import { PlugCircleIcon as PlugCircleBoldWeight } from "@solar-icons/react/bold/plug-circle"
import { PlusMinusIcon as PlusMinusBoldWeight } from "@solar-icons/react/bold/plus-minus"
import { PulseIcon as PulseBoldWeight } from "@solar-icons/react/bold/pulse"
import { RefreshIcon as RefreshBoldWeight } from "@solar-icons/react/bold/refresh"
import { RefreshCircleIcon as RefreshCircleBoldWeight } from "@solar-icons/react/bold/refresh-circle"
import { ReorderIcon as ReorderBoldWeight } from "@solar-icons/react/bold/reorder"
import { RepeatIcon as RepeatBoldWeight } from "@solar-icons/react/bold/repeat"
import { ReplyIcon as ReplyBoldWeight } from "@solar-icons/react/bold/reply"
import { RestartIcon as RestartBoldWeight } from "@solar-icons/react/bold/restart"
import { RouteIcon as RouteBoldWeight } from "@solar-icons/react/bold/route"
import { ScaleIcon as ScaleBoldWeight } from "@solar-icons/react/bold/scale"
import { ServerIcon as ServerBoldWeight } from "@solar-icons/react/bold/server"
import { SettingsIcon as SettingsBoldWeight } from "@solar-icons/react/bold/settings"
import { ShareIcon as ShareBoldWeight } from "@solar-icons/react/bold/share"
import { ShieldCheckIcon as ShieldCheckBoldWeight } from "@solar-icons/react/bold/shield-check"
import { SidebarMinimalisticIcon as SidebarMinimalisticBoldWeight } from "@solar-icons/react/bold/sidebar-minimalistic"
import { SliderHorizontalIcon as SliderHorizontalBoldWeight } from "@solar-icons/react/bold/slider-horizontal"
import { SmartphoneIcon as SmartphoneBoldWeight } from "@solar-icons/react/bold/smartphone"
import { SortIcon as SortBoldWeight } from "@solar-icons/react/bold/sort"
import { SortByTimeIcon as SortByTimeBoldWeight } from "@solar-icons/react/bold/sort-by-time"
import { SortHorizontalIcon as SortHorizontalBoldWeight } from "@solar-icons/react/bold/sort-horizontal"
import { SortVerticalIcon as SortVerticalBoldWeight } from "@solar-icons/react/bold/sort-vertical"
import { StarIcon as StarBoldWeight } from "@solar-icons/react/bold/star"
import { StructureIcon as StructureBoldWeight } from "@solar-icons/react/bold/structure"
import { SunIcon as SunBoldWeight } from "@solar-icons/react/bold/sun"
import { TagIcon as TagBoldWeight } from "@solar-icons/react/bold/tag"
import { TelescopeIcon as TelescopeBoldWeight } from "@solar-icons/react/bold/telescope"
import { TestTubeIcon as TestTubeBoldWeight } from "@solar-icons/react/bold/test-tube"
import { TextFormatIcon as TextFormatBoldWeight } from "@solar-icons/react/bold/text-format"
import { TransferHorizontalIcon as TransferHorizontalBoldWeight } from "@solar-icons/react/bold/transfer-horizontal"
import { TranslationIcon as TranslationBoldWeight } from "@solar-icons/react/bold/translation"
import { TrashBinMinimalisticIcon as TrashBinMinimalisticBoldWeight } from "@solar-icons/react/bold/trash-bin-minimalistic"
import { UndoLeftIcon as UndoLeftBoldWeight } from "@solar-icons/react/bold/undo-left"
import { UndoLeftRoundIcon as UndoLeftRoundBoldWeight } from "@solar-icons/react/bold/undo-left-round"
import { UndoRightIcon as UndoRightBoldWeight } from "@solar-icons/react/bold/undo-right"
import { UndoRightRoundIcon as UndoRightRoundBoldWeight } from "@solar-icons/react/bold/undo-right-round"
import { UploadIcon as UploadBoldWeight } from "@solar-icons/react/bold/upload"
import { UserIcon as UserBoldWeight } from "@solar-icons/react/bold/user"
import { UserIdIcon as UserIdBoldWeight } from "@solar-icons/react/bold/user-id"
import { UserMinusIcon as UserMinusBoldWeight } from "@solar-icons/react/bold/user-minus"
import { UserPlusIcon as UserPlusBoldWeight } from "@solar-icons/react/bold/user-plus"
import { UsersGroupRoundedIcon as UsersGroupRoundedBoldWeight } from "@solar-icons/react/bold/users-group-rounded"
import { UsersGroupTwoRoundedIcon as UsersGroupTwoRoundedBoldWeight } from "@solar-icons/react/bold/users-group-two-rounded"
import { VideoFrameIcon as VideoFrameBoldWeight } from "@solar-icons/react/bold/video-frame"
import { Widget2Icon as Widget2BoldWeight } from "@solar-icons/react/bold/widget-2"
import { Widget5Icon as Widget5BoldWeight } from "@solar-icons/react/bold/widget-5"
import { WindowFrameIcon as WindowFrameBoldWeight } from "@solar-icons/react/bold/window-frame"
import { AddCircleIcon as AddCircleBoldDuotone } from "@solar-icons/react/bold-duotone/add-circle"
import { AlignLeftIcon as AlignLeftBoldDuotone } from "@solar-icons/react/bold-duotone/align-left"
import { AltArrowDownIcon as AltArrowDownBoldDuotone } from "@solar-icons/react/bold-duotone/alt-arrow-down"
import { AltArrowLeftIcon as AltArrowLeftBoldDuotone } from "@solar-icons/react/bold-duotone/alt-arrow-left"
import { AltArrowRightIcon as AltArrowRightBoldDuotone } from "@solar-icons/react/bold-duotone/alt-arrow-right"
import { AltArrowUpIcon as AltArrowUpBoldDuotone } from "@solar-icons/react/bold-duotone/alt-arrow-up"
import { ArchiveIcon as ArchiveBoldDuotone } from "@solar-icons/react/bold-duotone/archive"
import { ArrowRightIcon as ArrowRightBoldDuotone } from "@solar-icons/react/bold-duotone/arrow-right"
import { ArrowToTopLeftIcon as ArrowToTopLeftBoldDuotone } from "@solar-icons/react/bold-duotone/arrow-to-top-left"
import { ArrowToTopRightIcon as ArrowToTopRightBoldDuotone } from "@solar-icons/react/bold-duotone/arrow-to-top-right"
import { BellIcon as BellBoldDuotone } from "@solar-icons/react/bold-duotone/bell"
import { BoltIcon as BoltBoldDuotone } from "@solar-icons/react/bold-duotone/bolt"
import { BookIcon as BookBoldDuotone } from "@solar-icons/react/bold-duotone/book"
import { Book2Icon as Book2BoldDuotone } from "@solar-icons/react/bold-duotone/book-2"
import { BookmarkIcon as BookmarkBoldDuotone } from "@solar-icons/react/bold-duotone/bookmark"
import { BookmarkCircleIcon as BookmarkCircleBoldDuotone } from "@solar-icons/react/bold-duotone/bookmark-circle"
import { BoxIcon as BoxBoldDuotone } from "@solar-icons/react/bold-duotone/box"
import { BranchingPathsUpIcon as BranchingPathsUpBoldDuotone } from "@solar-icons/react/bold-duotone/branching-paths-up"
import { CalendarDateIcon as CalendarDateBoldDuotone } from "@solar-icons/react/bold-duotone/calendar-date"
import { ChatRoundIcon as ChatRoundBoldDuotone } from "@solar-icons/react/bold-duotone/chat-round"
import { ChatRoundDotsIcon as ChatRoundDotsBoldDuotone } from "@solar-icons/react/bold-duotone/chat-round-dots"
import { ChatRoundLineIcon as ChatRoundLineBoldDuotone } from "@solar-icons/react/bold-duotone/chat-round-line"
import { ChatSquareIcon as ChatSquareBoldDuotone } from "@solar-icons/react/bold-duotone/chat-square"
import { CheckCircleIcon as CheckCircleBoldDuotone } from "@solar-icons/react/bold-duotone/check-circle"
import { ChecklistIcon as ChecklistBoldDuotone } from "@solar-icons/react/bold-duotone/checklist"
import { ClipboardListIcon as ClipboardListBoldDuotone } from "@solar-icons/react/bold-duotone/clipboard-list"
import { ClockCircleIcon as ClockCircleBoldDuotone } from "@solar-icons/react/bold-duotone/clock-circle"
import { CompassIcon as CompassBoldDuotone } from "@solar-icons/react/bold-duotone/compass"
import { CopyIcon as CopyBoldDuotone } from "@solar-icons/react/bold-duotone/copy"
import { CrownIcon as CrownBoldDuotone } from "@solar-icons/react/bold-duotone/crown"
import { DangerTriangleIcon as DangerTriangleBoldDuotone } from "@solar-icons/react/bold-duotone/danger-triangle"
import { DatabaseIcon as DatabaseBoldDuotone } from "@solar-icons/react/bold-duotone/database"
import { DisketteIcon as DisketteBoldDuotone } from "@solar-icons/react/bold-duotone/diskette"
import { DislikeIcon as DislikeBoldDuotone } from "@solar-icons/react/bold-duotone/dislike"
import { DocumentAddIcon as DocumentAddBoldDuotone } from "@solar-icons/react/bold-duotone/document-add"
import { DocumentTextIcon as DocumentTextBoldDuotone } from "@solar-icons/react/bold-duotone/document-text"
import { DoubleAltArrowDownIcon as DoubleAltArrowDownBoldDuotone } from "@solar-icons/react/bold-duotone/double-alt-arrow-down"
import { DownloadIcon as DownloadBoldDuotone } from "@solar-icons/react/bold-duotone/download"
import { EraserIcon as EraserBoldDuotone } from "@solar-icons/react/bold-duotone/eraser"
import { EyeIcon as EyeBoldDuotone } from "@solar-icons/react/bold-duotone/eye"
import { FileIcon as FileBoldDuotone } from "@solar-icons/react/bold-duotone/file"
import { FileRemoveIcon as FileRemoveBoldDuotone } from "@solar-icons/react/bold-duotone/file-remove"
import { FileTextIcon as FileTextBoldDuotone } from "@solar-icons/react/bold-duotone/file-text"
import { FilterIcon as FilterBoldDuotone } from "@solar-icons/react/bold-duotone/filter"
import { FiltersIcon as FiltersBoldDuotone } from "@solar-icons/react/bold-duotone/filters"
import { FolderIcon as FolderBoldDuotone } from "@solar-icons/react/bold-duotone/folder"
import { FolderOpenIcon as FolderOpenBoldDuotone } from "@solar-icons/react/bold-duotone/folder-open"
import { FolderPathConnectIcon as FolderPathConnectBoldDuotone } from "@solar-icons/react/bold-duotone/folder-path-connect"
import { ForbiddenCircleIcon as ForbiddenCircleBoldDuotone } from "@solar-icons/react/bold-duotone/forbidden-circle"
import { GalleryIcon as GalleryBoldDuotone } from "@solar-icons/react/bold-duotone/gallery"
import { GalleryAddIcon as GalleryAddBoldDuotone } from "@solar-icons/react/bold-duotone/gallery-add"
import { GalleryWideIcon as GalleryWideBoldDuotone } from "@solar-icons/react/bold-duotone/gallery-wide"
import { GlobalIcon as GlobalBoldDuotone } from "@solar-icons/react/bold-duotone/global"
import { GraphDownIcon as GraphDownBoldDuotone } from "@solar-icons/react/bold-duotone/graph-down"
import { GraphUpIcon as GraphUpBoldDuotone } from "@solar-icons/react/bold-duotone/graph-up"
import { HamburgerMenuIcon as HamburgerMenuBoldDuotone } from "@solar-icons/react/bold-duotone/hamburger-menu"
import { HandHeartIcon as HandHeartBoldDuotone } from "@solar-icons/react/bold-duotone/hand-heart"
import { HeartIcon as HeartBoldDuotone } from "@solar-icons/react/bold-duotone/heart"
import { HelpIcon as HelpBoldDuotone } from "@solar-icons/react/bold-duotone/help"
import { HistoryIcon as HistoryBoldDuotone } from "@solar-icons/react/bold-duotone/history"
import { HomeAngleIcon as HomeAngleBoldDuotone } from "@solar-icons/react/bold-duotone/home-angle"
import { InfoCircleIcon as InfoCircleBoldDuotone } from "@solar-icons/react/bold-duotone/info-circle"
import { LayersIcon as LayersBoldDuotone } from "@solar-icons/react/bold-duotone/layers"
import { LetterIcon as LetterBoldDuotone } from "@solar-icons/react/bold-duotone/letter"
import { LikeIcon as LikeBoldDuotone } from "@solar-icons/react/bold-duotone/like"
import { LinkIcon as LinkBoldDuotone } from "@solar-icons/react/bold-duotone/link"
import { ListIcon as ListBoldDuotone } from "@solar-icons/react/bold-duotone/list"
import { ListVerticalIcon as ListVerticalBoldDuotone } from "@solar-icons/react/bold-duotone/list-vertical"
import { LockPasswordIcon as LockPasswordBoldDuotone } from "@solar-icons/react/bold-duotone/lock-password"
import { Login2Icon as Login2BoldDuotone } from "@solar-icons/react/bold-duotone/login-2"
import { LogoutIcon as LogoutBoldDuotone } from "@solar-icons/react/bold-duotone/logout"
import { MagicWand2Icon as MagicWand2BoldDuotone } from "@solar-icons/react/bold-duotone/magic-wand-2"
import { MagnifierIcon as MagnifierBoldDuotone } from "@solar-icons/react/bold-duotone/magnifier"
import { MagnifierZoomInIcon as MagnifierZoomInBoldDuotone } from "@solar-icons/react/bold-duotone/magnifier-zoom-in"
import { MagnifierZoomOutIcon as MagnifierZoomOutBoldDuotone } from "@solar-icons/react/bold-duotone/magnifier-zoom-out"
import { MaximizeIcon as MaximizeBoldDuotone } from "@solar-icons/react/bold-duotone/maximize"
import { MenuDotsIcon as MenuDotsBoldDuotone } from "@solar-icons/react/bold-duotone/menu-dots"
import { MinimizeIcon as MinimizeBoldDuotone } from "@solar-icons/react/bold-duotone/minimize"
import { MinusSquareIcon as MinusSquareBoldDuotone } from "@solar-icons/react/bold-duotone/minus-square"
import { MonitorIcon as MonitorBoldDuotone } from "@solar-icons/react/bold-duotone/monitor"
import { MonitorSmartphoneIcon as MonitorSmartphoneBoldDuotone } from "@solar-icons/react/bold-duotone/monitor-smartphone"
import { MoonIcon as MoonBoldDuotone } from "@solar-icons/react/bold-duotone/moon"
import { MoveToFolderIcon as MoveToFolderBoldDuotone } from "@solar-icons/react/bold-duotone/move-to-folder"
import { MusicNotesIcon as MusicNotesBoldDuotone } from "@solar-icons/react/bold-duotone/music-notes"
import { PaletteIcon as PaletteBoldDuotone } from "@solar-icons/react/bold-duotone/palette"
import { PaletteRoundIcon as PaletteRoundBoldDuotone } from "@solar-icons/react/bold-duotone/palette-round"
import { PauseIcon as PauseBoldDuotone } from "@solar-icons/react/bold-duotone/pause"
import { PenIcon as PenBoldDuotone } from "@solar-icons/react/bold-duotone/pen"
import { PenNewRoundIcon as PenNewRoundBoldDuotone } from "@solar-icons/react/bold-duotone/pen-new-round"
import { PieChartIcon as PieChartBoldDuotone } from "@solar-icons/react/bold-duotone/pie-chart"
import { PinIcon as PinBoldDuotone } from "@solar-icons/react/bold-duotone/pin"
import { PlayIcon as PlayBoldDuotone } from "@solar-icons/react/bold-duotone/play"
import { PlugCircleIcon as PlugCircleBoldDuotone } from "@solar-icons/react/bold-duotone/plug-circle"
import { PlusMinusIcon as PlusMinusBoldDuotone } from "@solar-icons/react/bold-duotone/plus-minus"
import { PulseIcon as PulseBoldDuotone } from "@solar-icons/react/bold-duotone/pulse"
import { RefreshIcon as RefreshBoldDuotone } from "@solar-icons/react/bold-duotone/refresh"
import { RefreshCircleIcon as RefreshCircleBoldDuotone } from "@solar-icons/react/bold-duotone/refresh-circle"
import { ReorderIcon as ReorderBoldDuotone } from "@solar-icons/react/bold-duotone/reorder"
import { RepeatIcon as RepeatBoldDuotone } from "@solar-icons/react/bold-duotone/repeat"
import { ReplyIcon as ReplyBoldDuotone } from "@solar-icons/react/bold-duotone/reply"
import { RestartIcon as RestartBoldDuotone } from "@solar-icons/react/bold-duotone/restart"
import { RouteIcon as RouteBoldDuotone } from "@solar-icons/react/bold-duotone/route"
import { ScaleIcon as ScaleBoldDuotone } from "@solar-icons/react/bold-duotone/scale"
import { ServerIcon as ServerBoldDuotone } from "@solar-icons/react/bold-duotone/server"
import { SettingsIcon as SettingsBoldDuotone } from "@solar-icons/react/bold-duotone/settings"
import { ShareIcon as ShareBoldDuotone } from "@solar-icons/react/bold-duotone/share"
import { ShieldCheckIcon as ShieldCheckBoldDuotone } from "@solar-icons/react/bold-duotone/shield-check"
import { SidebarMinimalisticIcon as SidebarMinimalisticBoldDuotone } from "@solar-icons/react/bold-duotone/sidebar-minimalistic"
import { SliderHorizontalIcon as SliderHorizontalBoldDuotone } from "@solar-icons/react/bold-duotone/slider-horizontal"
import { SmartphoneIcon as SmartphoneBoldDuotone } from "@solar-icons/react/bold-duotone/smartphone"
import { SortIcon as SortBoldDuotone } from "@solar-icons/react/bold-duotone/sort"
import { SortByTimeIcon as SortByTimeBoldDuotone } from "@solar-icons/react/bold-duotone/sort-by-time"
import { SortHorizontalIcon as SortHorizontalBoldDuotone } from "@solar-icons/react/bold-duotone/sort-horizontal"
import { SortVerticalIcon as SortVerticalBoldDuotone } from "@solar-icons/react/bold-duotone/sort-vertical"
import { StarIcon as StarBoldDuotone } from "@solar-icons/react/bold-duotone/star"
import { StructureIcon as StructureBoldDuotone } from "@solar-icons/react/bold-duotone/structure"
import { SunIcon as SunBoldDuotone } from "@solar-icons/react/bold-duotone/sun"
import { TagIcon as TagBoldDuotone } from "@solar-icons/react/bold-duotone/tag"
import { TelescopeIcon as TelescopeBoldDuotone } from "@solar-icons/react/bold-duotone/telescope"
import { TestTubeIcon as TestTubeBoldDuotone } from "@solar-icons/react/bold-duotone/test-tube"
import { TextFormatIcon as TextFormatBoldDuotone } from "@solar-icons/react/bold-duotone/text-format"
import { TransferHorizontalIcon as TransferHorizontalBoldDuotone } from "@solar-icons/react/bold-duotone/transfer-horizontal"
import { TranslationIcon as TranslationBoldDuotone } from "@solar-icons/react/bold-duotone/translation"
import { TrashBinMinimalisticIcon as TrashBinMinimalisticBoldDuotone } from "@solar-icons/react/bold-duotone/trash-bin-minimalistic"
import { UndoLeftIcon as UndoLeftBoldDuotone } from "@solar-icons/react/bold-duotone/undo-left"
import { UndoLeftRoundIcon as UndoLeftRoundBoldDuotone } from "@solar-icons/react/bold-duotone/undo-left-round"
import { UndoRightIcon as UndoRightBoldDuotone } from "@solar-icons/react/bold-duotone/undo-right"
import { UndoRightRoundIcon as UndoRightRoundBoldDuotone } from "@solar-icons/react/bold-duotone/undo-right-round"
import { UploadIcon as UploadBoldDuotone } from "@solar-icons/react/bold-duotone/upload"
import { UserIcon as UserBoldDuotone } from "@solar-icons/react/bold-duotone/user"
import { UserIdIcon as UserIdBoldDuotone } from "@solar-icons/react/bold-duotone/user-id"
import { UserMinusIcon as UserMinusBoldDuotone } from "@solar-icons/react/bold-duotone/user-minus"
import { UserPlusIcon as UserPlusBoldDuotone } from "@solar-icons/react/bold-duotone/user-plus"
import { UsersGroupRoundedIcon as UsersGroupRoundedBoldDuotone } from "@solar-icons/react/bold-duotone/users-group-rounded"
import { UsersGroupTwoRoundedIcon as UsersGroupTwoRoundedBoldDuotone } from "@solar-icons/react/bold-duotone/users-group-two-rounded"
import { VideoFrameIcon as VideoFrameBoldDuotone } from "@solar-icons/react/bold-duotone/video-frame"
import { Widget2Icon as Widget2BoldDuotone } from "@solar-icons/react/bold-duotone/widget-2"
import { Widget5Icon as Widget5BoldDuotone } from "@solar-icons/react/bold-duotone/widget-5"
import { WindowFrameIcon as WindowFrameBoldDuotone } from "@solar-icons/react/bold-duotone/window-frame"
import { AddCircleIcon as AddCircleLinear } from "@solar-icons/react/linear/add-circle"
import { AlignLeftIcon as AlignLeftLinear } from "@solar-icons/react/linear/align-left"
import { AltArrowDownIcon as AltArrowDownLinear } from "@solar-icons/react/linear/alt-arrow-down"
import { AltArrowLeftIcon as AltArrowLeftLinear } from "@solar-icons/react/linear/alt-arrow-left"
import { AltArrowRightIcon as AltArrowRightLinear } from "@solar-icons/react/linear/alt-arrow-right"
import { AltArrowUpIcon as AltArrowUpLinear } from "@solar-icons/react/linear/alt-arrow-up"
import { ArchiveIcon as ArchiveLinear } from "@solar-icons/react/linear/archive"
import { ArrowRightIcon as ArrowRightLinear } from "@solar-icons/react/linear/arrow-right"
import { ArrowToTopLeftIcon as ArrowToTopLeftLinear } from "@solar-icons/react/linear/arrow-to-top-left"
import { ArrowToTopRightIcon as ArrowToTopRightLinear } from "@solar-icons/react/linear/arrow-to-top-right"
import { BellIcon as BellLinear } from "@solar-icons/react/linear/bell"
import { BoltIcon as BoltLinear } from "@solar-icons/react/linear/bolt"
import { BookIcon as BookLinear } from "@solar-icons/react/linear/book"
import { Book2Icon as Book2Linear } from "@solar-icons/react/linear/book-2"
import { BookmarkIcon as BookmarkLinear } from "@solar-icons/react/linear/bookmark"
import { BookmarkCircleIcon as BookmarkCircleLinear } from "@solar-icons/react/linear/bookmark-circle"
import { BoxIcon as BoxLinear } from "@solar-icons/react/linear/box"
import { BranchingPathsUpIcon as BranchingPathsUpLinear } from "@solar-icons/react/linear/branching-paths-up"
import { CalendarDateIcon as CalendarDateLinear } from "@solar-icons/react/linear/calendar-date"
import { ChatRoundIcon as ChatRoundLinear } from "@solar-icons/react/linear/chat-round"
import { ChatRoundDotsIcon as ChatRoundDotsLinear } from "@solar-icons/react/linear/chat-round-dots"
import { ChatRoundLineIcon as ChatRoundLineLinear } from "@solar-icons/react/linear/chat-round-line"
import { ChatSquareIcon as ChatSquareLinear } from "@solar-icons/react/linear/chat-square"
import { CheckCircleIcon as CheckCircleLinear } from "@solar-icons/react/linear/check-circle"
import { ChecklistIcon as ChecklistLinear } from "@solar-icons/react/linear/checklist"
import { ClipboardListIcon as ClipboardListLinear } from "@solar-icons/react/linear/clipboard-list"
import { ClockCircleIcon as ClockCircleLinear } from "@solar-icons/react/linear/clock-circle"
import { CompassIcon as CompassLinear } from "@solar-icons/react/linear/compass"
import { CopyIcon as CopyLinear } from "@solar-icons/react/linear/copy"
import { CrownIcon as CrownLinear } from "@solar-icons/react/linear/crown"
import { DangerTriangleIcon as DangerTriangleLinear } from "@solar-icons/react/linear/danger-triangle"
import { DatabaseIcon as DatabaseLinear } from "@solar-icons/react/linear/database"
import { DisketteIcon as DisketteLinear } from "@solar-icons/react/linear/diskette"
import { DislikeIcon as DislikeLinear } from "@solar-icons/react/linear/dislike"
import { DocumentAddIcon as DocumentAddLinear } from "@solar-icons/react/linear/document-add"
import { DocumentTextIcon as DocumentTextLinear } from "@solar-icons/react/linear/document-text"
import { DoubleAltArrowDownIcon as DoubleAltArrowDownLinear } from "@solar-icons/react/linear/double-alt-arrow-down"
import { DownloadIcon as DownloadLinear } from "@solar-icons/react/linear/download"
import { EraserIcon as EraserLinear } from "@solar-icons/react/linear/eraser"
import { EyeIcon as EyeLinear } from "@solar-icons/react/linear/eye"
import { FileIcon as FileLinear } from "@solar-icons/react/linear/file"
import { FileRemoveIcon as FileRemoveLinear } from "@solar-icons/react/linear/file-remove"
import { FileTextIcon as FileTextLinear } from "@solar-icons/react/linear/file-text"
import { FilterIcon as FilterLinear } from "@solar-icons/react/linear/filter"
import { FiltersIcon as FiltersLinear } from "@solar-icons/react/linear/filters"
import { FolderIcon as FolderLinear } from "@solar-icons/react/linear/folder"
import { FolderOpenIcon as FolderOpenLinear } from "@solar-icons/react/linear/folder-open"
import { FolderPathConnectIcon as FolderPathConnectLinear } from "@solar-icons/react/linear/folder-path-connect"
import { ForbiddenCircleIcon as ForbiddenCircleLinear } from "@solar-icons/react/linear/forbidden-circle"
import { GalleryIcon as GalleryLinear } from "@solar-icons/react/linear/gallery"
import { GalleryAddIcon as GalleryAddLinear } from "@solar-icons/react/linear/gallery-add"
import { GalleryWideIcon as GalleryWideLinear } from "@solar-icons/react/linear/gallery-wide"
import { GlobalIcon as GlobalLinear } from "@solar-icons/react/linear/global"
import { GraphDownIcon as GraphDownLinear } from "@solar-icons/react/linear/graph-down"
import { GraphUpIcon as GraphUpLinear } from "@solar-icons/react/linear/graph-up"
import { HamburgerMenuIcon as HamburgerMenuLinear } from "@solar-icons/react/linear/hamburger-menu"
import { HandHeartIcon as HandHeartLinear } from "@solar-icons/react/linear/hand-heart"
import { HeartIcon as HeartLinear } from "@solar-icons/react/linear/heart"
import { HelpIcon as HelpLinear } from "@solar-icons/react/linear/help"
import { HistoryIcon as HistoryLinear } from "@solar-icons/react/linear/history"
import { HomeAngleIcon as HomeAngleLinear } from "@solar-icons/react/linear/home-angle"
import { InfoCircleIcon as InfoCircleLinear } from "@solar-icons/react/linear/info-circle"
import { LayersIcon as LayersLinear } from "@solar-icons/react/linear/layers"
import { LetterIcon as LetterLinear } from "@solar-icons/react/linear/letter"
import { LikeIcon as LikeLinear } from "@solar-icons/react/linear/like"
import { LinkIcon as LinkLinear } from "@solar-icons/react/linear/link"
import { ListIcon as ListLinear } from "@solar-icons/react/linear/list"
import { ListVerticalIcon as ListVerticalLinear } from "@solar-icons/react/linear/list-vertical"
import { LockPasswordIcon as LockPasswordLinear } from "@solar-icons/react/linear/lock-password"
import { Login2Icon as Login2Linear } from "@solar-icons/react/linear/login-2"
import { LogoutIcon as LogoutLinear } from "@solar-icons/react/linear/logout"
import { MagicWand2Icon as MagicWand2Linear } from "@solar-icons/react/linear/magic-wand-2"
import { MagnifierIcon as MagnifierLinear } from "@solar-icons/react/linear/magnifier"
import { MagnifierZoomInIcon as MagnifierZoomInLinear } from "@solar-icons/react/linear/magnifier-zoom-in"
import { MagnifierZoomOutIcon as MagnifierZoomOutLinear } from "@solar-icons/react/linear/magnifier-zoom-out"
import { MaximizeIcon as MaximizeLinear } from "@solar-icons/react/linear/maximize"
import { MinimizeIcon as MinimizeLinear } from "@solar-icons/react/linear/minimize"
import { MinusSquareIcon as MinusSquareLinear } from "@solar-icons/react/linear/minus-square"
import { MonitorIcon as MonitorLinear } from "@solar-icons/react/linear/monitor"
import { MonitorSmartphoneIcon as MonitorSmartphoneLinear } from "@solar-icons/react/linear/monitor-smartphone"
import { MoonIcon as MoonLinear } from "@solar-icons/react/linear/moon"
import { MoveToFolderIcon as MoveToFolderLinear } from "@solar-icons/react/linear/move-to-folder"
import { MusicNotesIcon as MusicNotesLinear } from "@solar-icons/react/linear/music-notes"
import { PaletteIcon as PaletteLinear } from "@solar-icons/react/linear/palette"
import { PaletteRoundIcon as PaletteRoundLinear } from "@solar-icons/react/linear/palette-round"
import { PauseIcon as PauseLinear } from "@solar-icons/react/linear/pause"
import { PenIcon as PenLinear } from "@solar-icons/react/linear/pen"
import { PenNewRoundIcon as PenNewRoundLinear } from "@solar-icons/react/linear/pen-new-round"
import { PieChartIcon as PieChartLinear } from "@solar-icons/react/linear/pie-chart"
import { PinIcon as PinLinear } from "@solar-icons/react/linear/pin"
import { PlayIcon as PlayLinear } from "@solar-icons/react/linear/play"
import { PlugCircleIcon as PlugCircleLinear } from "@solar-icons/react/linear/plug-circle"
import { PlusMinusIcon as PlusMinusLinear } from "@solar-icons/react/linear/plus-minus"
import { PulseIcon as PulseLinear } from "@solar-icons/react/linear/pulse"
import { RefreshIcon as RefreshLinear } from "@solar-icons/react/linear/refresh"
import { RefreshCircleIcon as RefreshCircleLinear } from "@solar-icons/react/linear/refresh-circle"
import { ReorderIcon as ReorderLinear } from "@solar-icons/react/linear/reorder"
import { RepeatIcon as RepeatLinear } from "@solar-icons/react/linear/repeat"
import { ReplyIcon as ReplyLinear } from "@solar-icons/react/linear/reply"
import { RestartIcon as RestartLinear } from "@solar-icons/react/linear/restart"
import { RouteIcon as RouteLinear } from "@solar-icons/react/linear/route"
import { ScaleIcon as ScaleLinear } from "@solar-icons/react/linear/scale"
import { ServerIcon as ServerLinear } from "@solar-icons/react/linear/server"
import { SettingsIcon as SettingsLinear } from "@solar-icons/react/linear/settings"
import { ShareIcon as ShareLinear } from "@solar-icons/react/linear/share"
import { ShieldCheckIcon as ShieldCheckLinear } from "@solar-icons/react/linear/shield-check"
import { SidebarMinimalisticIcon as SidebarMinimalisticLinear } from "@solar-icons/react/linear/sidebar-minimalistic"
import { SliderHorizontalIcon as SliderHorizontalLinear } from "@solar-icons/react/linear/slider-horizontal"
import { SmartphoneIcon as SmartphoneLinear } from "@solar-icons/react/linear/smartphone"
import { SortIcon as SortLinear } from "@solar-icons/react/linear/sort"
import { SortByTimeIcon as SortByTimeLinear } from "@solar-icons/react/linear/sort-by-time"
import { SortHorizontalIcon as SortHorizontalLinear } from "@solar-icons/react/linear/sort-horizontal"
import { SortVerticalIcon as SortVerticalLinear } from "@solar-icons/react/linear/sort-vertical"
import { StarIcon as StarLinear } from "@solar-icons/react/linear/star"
import { StructureIcon as StructureLinear } from "@solar-icons/react/linear/structure"
import { SunIcon as SunLinear } from "@solar-icons/react/linear/sun"
import { TagIcon as TagLinear } from "@solar-icons/react/linear/tag"
import { TelescopeIcon as TelescopeLinear } from "@solar-icons/react/linear/telescope"
import { TestTubeIcon as TestTubeLinear } from "@solar-icons/react/linear/test-tube"
import { TextFormatIcon as TextFormatLinear } from "@solar-icons/react/linear/text-format"
import { TransferHorizontalIcon as TransferHorizontalLinear } from "@solar-icons/react/linear/transfer-horizontal"
import { TranslationIcon as TranslationLinear } from "@solar-icons/react/linear/translation"
import { TrashBinMinimalisticIcon as TrashBinMinimalisticLinear } from "@solar-icons/react/linear/trash-bin-minimalistic"
import { UndoLeftIcon as UndoLeftLinear } from "@solar-icons/react/linear/undo-left"
import { UndoLeftRoundIcon as UndoLeftRoundLinear } from "@solar-icons/react/linear/undo-left-round"
import { UndoRightIcon as UndoRightLinear } from "@solar-icons/react/linear/undo-right"
import { UndoRightRoundIcon as UndoRightRoundLinear } from "@solar-icons/react/linear/undo-right-round"
import { UploadIcon as UploadLinear } from "@solar-icons/react/linear/upload"
import { UserIcon as UserLinear } from "@solar-icons/react/linear/user"
import { UserIdIcon as UserIdLinear } from "@solar-icons/react/linear/user-id"
import { UserMinusIcon as UserMinusLinear } from "@solar-icons/react/linear/user-minus"
import { UserPlusIcon as UserPlusLinear } from "@solar-icons/react/linear/user-plus"
import { UsersGroupRoundedIcon as UsersGroupRoundedLinear } from "@solar-icons/react/linear/users-group-rounded"
import { UsersGroupTwoRoundedIcon as UsersGroupTwoRoundedLinear } from "@solar-icons/react/linear/users-group-two-rounded"
import { VideoFrameIcon as VideoFrameLinear } from "@solar-icons/react/linear/video-frame"
import { Widget2Icon as Widget2Linear } from "@solar-icons/react/linear/widget-2"
import { Widget5Icon as Widget5Linear } from "@solar-icons/react/linear/widget-5"
import { WindowFrameIcon as WindowFrameLinear } from "@solar-icons/react/linear/window-frame"
import { createIcon } from "./icon-style"

// ── One icon per glyph - three parallel Solar weights ────────────
export const AddCircle = createIcon({
	bold: AddCircleBoldWeight,
	boldDuotone: AddCircleBoldDuotone,
	linear: AddCircleLinear,
})
export const AlignLeft = createIcon({
	bold: AlignLeftBoldWeight,
	boldDuotone: AlignLeftBoldDuotone,
	linear: AlignLeftLinear,
})
export const AltArrowDown = createIcon({
	bold: AltArrowDownBoldWeight,
	boldDuotone: AltArrowDownBoldDuotone,
	linear: AltArrowDownLinear,
})
export const AltArrowLeft = createIcon({
	bold: AltArrowLeftBoldWeight,
	boldDuotone: AltArrowLeftBoldDuotone,
	linear: AltArrowLeftLinear,
})
export const AltArrowRight = createIcon({
	bold: AltArrowRightBoldWeight,
	boldDuotone: AltArrowRightBoldDuotone,
	linear: AltArrowRightLinear,
})
export const AltArrowUp = createIcon({
	bold: AltArrowUpBoldWeight,
	boldDuotone: AltArrowUpBoldDuotone,
	linear: AltArrowUpLinear,
})
export const Archive = createIcon({
	bold: ArchiveBoldWeight,
	boldDuotone: ArchiveBoldDuotone,
	linear: ArchiveLinear,
})
export const ArrowRight = createIcon({
	bold: ArrowRightBoldWeight,
	boldDuotone: ArrowRightBoldDuotone,
	linear: ArrowRightLinear,
})
export const ArrowToTopLeft = createIcon({
	bold: ArrowToTopLeftBoldWeight,
	boldDuotone: ArrowToTopLeftBoldDuotone,
	linear: ArrowToTopLeftLinear,
})
export const ArrowToTopRight = createIcon({
	bold: ArrowToTopRightBoldWeight,
	boldDuotone: ArrowToTopRightBoldDuotone,
	linear: ArrowToTopRightLinear,
})
export const Bell = createIcon({
	bold: BellBoldWeight,
	boldDuotone: BellBoldDuotone,
	linear: BellLinear,
})
export const Bolt = createIcon({
	bold: BoltBoldWeight,
	boldDuotone: BoltBoldDuotone,
	linear: BoltLinear,
})
export const Book = createIcon({
	bold: BookBoldWeight,
	boldDuotone: BookBoldDuotone,
	linear: BookLinear,
})
export const Book2 = createIcon({
	bold: Book2BoldWeight,
	boldDuotone: Book2BoldDuotone,
	linear: Book2Linear,
})
export const Bookmark = createIcon({
	bold: BookmarkBoldWeight,
	boldDuotone: BookmarkBoldDuotone,
	linear: BookmarkLinear,
})
export const BookmarkCircle = createIcon({
	bold: BookmarkCircleBoldWeight,
	boldDuotone: BookmarkCircleBoldDuotone,
	linear: BookmarkCircleLinear,
})
export const Box = createIcon({
	bold: BoxBoldWeight,
	boldDuotone: BoxBoldDuotone,
	linear: BoxLinear,
})
export const BranchingPathsUp = createIcon({
	bold: BranchingPathsUpBoldWeight,
	boldDuotone: BranchingPathsUpBoldDuotone,
	linear: BranchingPathsUpLinear,
})
export const CalendarDate = createIcon({
	bold: CalendarDateBoldWeight,
	boldDuotone: CalendarDateBoldDuotone,
	linear: CalendarDateLinear,
})
export const ChatRound = createIcon({
	bold: ChatRoundBoldWeight,
	boldDuotone: ChatRoundBoldDuotone,
	linear: ChatRoundLinear,
})
export const ChatRoundDots = createIcon({
	bold: ChatRoundDotsBoldWeight,
	boldDuotone: ChatRoundDotsBoldDuotone,
	linear: ChatRoundDotsLinear,
})
export const ChatRoundLine = createIcon({
	bold: ChatRoundLineBoldWeight,
	boldDuotone: ChatRoundLineBoldDuotone,
	linear: ChatRoundLineLinear,
})
export const ChatSquare = createIcon({
	bold: ChatSquareBoldWeight,
	boldDuotone: ChatSquareBoldDuotone,
	linear: ChatSquareLinear,
})
export const CheckCircle = createIcon({
	bold: CheckCircleBoldWeight,
	boldDuotone: CheckCircleBoldDuotone,
	linear: CheckCircleLinear,
})
export const Checklist = createIcon({
	bold: ChecklistBoldWeight,
	boldDuotone: ChecklistBoldDuotone,
	linear: ChecklistLinear,
})
export const ClipboardList = createIcon({
	bold: ClipboardListBoldWeight,
	boldDuotone: ClipboardListBoldDuotone,
	linear: ClipboardListLinear,
})
export const ClockCircle = createIcon({
	bold: ClockCircleBoldWeight,
	boldDuotone: ClockCircleBoldDuotone,
	linear: ClockCircleLinear,
})
export const Compass = createIcon({
	bold: CompassBoldWeight,
	boldDuotone: CompassBoldDuotone,
	linear: CompassLinear,
})
export const Copy = createIcon({
	bold: CopyBoldWeight,
	boldDuotone: CopyBoldDuotone,
	linear: CopyLinear,
})
export const Crown = createIcon({
	bold: CrownBoldWeight,
	boldDuotone: CrownBoldDuotone,
	linear: CrownLinear,
})
export const DangerTriangle = createIcon({
	bold: DangerTriangleBoldWeight,
	boldDuotone: DangerTriangleBoldDuotone,
	linear: DangerTriangleLinear,
})
export const Database = createIcon({
	bold: DatabaseBoldWeight,
	boldDuotone: DatabaseBoldDuotone,
	linear: DatabaseLinear,
})
export const Diskette = createIcon({
	bold: DisketteBoldWeight,
	boldDuotone: DisketteBoldDuotone,
	linear: DisketteLinear,
})
export const Dislike = createIcon({
	bold: DislikeBoldWeight,
	boldDuotone: DislikeBoldDuotone,
	linear: DislikeLinear,
})
export const DocumentAdd = createIcon({
	bold: DocumentAddBoldWeight,
	boldDuotone: DocumentAddBoldDuotone,
	linear: DocumentAddLinear,
})
export const DocumentText = createIcon({
	bold: DocumentTextBoldWeight,
	boldDuotone: DocumentTextBoldDuotone,
	linear: DocumentTextLinear,
})
export const DoubleAltArrowDown = createIcon({
	bold: DoubleAltArrowDownBoldWeight,
	boldDuotone: DoubleAltArrowDownBoldDuotone,
	linear: DoubleAltArrowDownLinear,
})
export const Download = createIcon({
	bold: DownloadBoldWeight,
	boldDuotone: DownloadBoldDuotone,
	linear: DownloadLinear,
})
export const Eraser = createIcon({
	bold: EraserBoldWeight,
	boldDuotone: EraserBoldDuotone,
	linear: EraserLinear,
})
export const Eye = createIcon({
	bold: EyeBoldWeight,
	boldDuotone: EyeBoldDuotone,
	linear: EyeLinear,
})
export const File = createIcon({
	bold: FileBoldWeight,
	boldDuotone: FileBoldDuotone,
	linear: FileLinear,
})
export const FileRemove = createIcon({
	bold: FileRemoveBoldWeight,
	boldDuotone: FileRemoveBoldDuotone,
	linear: FileRemoveLinear,
})
export const FileText = createIcon({
	bold: FileTextBoldWeight,
	boldDuotone: FileTextBoldDuotone,
	linear: FileTextLinear,
})
export const Filter = createIcon({
	bold: FilterBoldWeight,
	boldDuotone: FilterBoldDuotone,
	linear: FilterLinear,
})
export const Filters = createIcon({
	bold: FiltersBoldWeight,
	boldDuotone: FiltersBoldDuotone,
	linear: FiltersLinear,
})
export const Folder = createIcon({
	bold: FolderBoldWeight,
	boldDuotone: FolderBoldDuotone,
	linear: FolderLinear,
})
export const FolderOpen = createIcon({
	bold: FolderOpenBoldWeight,
	boldDuotone: FolderOpenBoldDuotone,
	linear: FolderOpenLinear,
})
export const FolderPathConnect = createIcon({
	bold: FolderPathConnectBoldWeight,
	boldDuotone: FolderPathConnectBoldDuotone,
	linear: FolderPathConnectLinear,
})
export const ForbiddenCircle = createIcon({
	bold: ForbiddenCircleBoldWeight,
	boldDuotone: ForbiddenCircleBoldDuotone,
	linear: ForbiddenCircleLinear,
})
export const Gallery = createIcon({
	bold: GalleryBoldWeight,
	boldDuotone: GalleryBoldDuotone,
	linear: GalleryLinear,
})
export const GalleryAdd = createIcon({
	bold: GalleryAddBoldWeight,
	boldDuotone: GalleryAddBoldDuotone,
	linear: GalleryAddLinear,
})
export const GalleryWide = createIcon({
	bold: GalleryWideBoldWeight,
	boldDuotone: GalleryWideBoldDuotone,
	linear: GalleryWideLinear,
})
export const Global = createIcon({
	bold: GlobalBoldWeight,
	boldDuotone: GlobalBoldDuotone,
	linear: GlobalLinear,
})
export const GraphDown = createIcon({
	bold: GraphDownBoldWeight,
	boldDuotone: GraphDownBoldDuotone,
	linear: GraphDownLinear,
})
export const GraphUp = createIcon({
	bold: GraphUpBoldWeight,
	boldDuotone: GraphUpBoldDuotone,
	linear: GraphUpLinear,
})
export const HamburgerMenu = createIcon({
	bold: HamburgerMenuBoldWeight,
	boldDuotone: HamburgerMenuBoldDuotone,
	linear: HamburgerMenuLinear,
})
export const HandHeart = createIcon({
	bold: HandHeartBoldWeight,
	boldDuotone: HandHeartBoldDuotone,
	linear: HandHeartLinear,
})
export const Heart = createIcon({
	bold: HeartBoldWeight,
	boldDuotone: HeartBoldDuotone,
	linear: HeartLinear,
})
export const Help = createIcon({
	bold: HelpBoldWeight,
	boldDuotone: HelpBoldDuotone,
	linear: HelpLinear,
})
export const History = createIcon({
	bold: HistoryBoldWeight,
	boldDuotone: HistoryBoldDuotone,
	linear: HistoryLinear,
})
export const HomeAngle = createIcon({
	bold: HomeAngleBoldWeight,
	boldDuotone: HomeAngleBoldDuotone,
	linear: HomeAngleLinear,
})
export const InfoCircle = createIcon({
	bold: InfoCircleBoldWeight,
	boldDuotone: InfoCircleBoldDuotone,
	linear: InfoCircleLinear,
})
export const Layers = createIcon({
	bold: LayersBoldWeight,
	boldDuotone: LayersBoldDuotone,
	linear: LayersLinear,
})
export const Letter = createIcon({
	bold: LetterBoldWeight,
	boldDuotone: LetterBoldDuotone,
	linear: LetterLinear,
})
export const Like = createIcon({
	bold: LikeBoldWeight,
	boldDuotone: LikeBoldDuotone,
	linear: LikeLinear,
})
export const Link = createIcon({
	bold: LinkBoldWeight,
	boldDuotone: LinkBoldDuotone,
	linear: LinkLinear,
})
export const List = createIcon({
	bold: ListBoldWeight,
	boldDuotone: ListBoldDuotone,
	linear: ListLinear,
})
export const ListVertical = createIcon({
	bold: ListVerticalBoldWeight,
	boldDuotone: ListVerticalBoldDuotone,
	linear: ListVerticalLinear,
})
export const LockPassword = createIcon({
	bold: LockPasswordBoldWeight,
	boldDuotone: LockPasswordBoldDuotone,
	linear: LockPasswordLinear,
})
export const Login2 = createIcon({
	bold: Login2BoldWeight,
	boldDuotone: Login2BoldDuotone,
	linear: Login2Linear,
})
export const Logout = createIcon({
	bold: LogoutBoldWeight,
	boldDuotone: LogoutBoldDuotone,
	linear: LogoutLinear,
})
export const MagicWand2 = createIcon({
	bold: MagicWand2BoldWeight,
	boldDuotone: MagicWand2BoldDuotone,
	linear: MagicWand2Linear,
})
export const Magnifier = createIcon({
	bold: MagnifierBoldWeight,
	boldDuotone: MagnifierBoldDuotone,
	linear: MagnifierLinear,
})
export const MagnifierZoomIn = createIcon({
	bold: MagnifierZoomInBoldWeight,
	boldDuotone: MagnifierZoomInBoldDuotone,
	linear: MagnifierZoomInLinear,
})
export const MagnifierZoomOut = createIcon({
	bold: MagnifierZoomOutBoldWeight,
	boldDuotone: MagnifierZoomOutBoldDuotone,
	linear: MagnifierZoomOutLinear,
})
export const Maximize = createIcon({
	bold: MaximizeBoldWeight,
	boldDuotone: MaximizeBoldDuotone,
	linear: MaximizeLinear,
})
export const MenuDots = createIcon({
	bold: MenuDotsBoldWeight,
	boldDuotone: MenuDotsBoldDuotone,
	linear: MenuDotsBoldWeight,
})
export const Minimize = createIcon({
	bold: MinimizeBoldWeight,
	boldDuotone: MinimizeBoldDuotone,
	linear: MinimizeLinear,
})
export const MinusSquare = createIcon({
	bold: MinusSquareBoldWeight,
	boldDuotone: MinusSquareBoldDuotone,
	linear: MinusSquareLinear,
})
export const Monitor = createIcon({
	bold: MonitorBoldWeight,
	boldDuotone: MonitorBoldDuotone,
	linear: MonitorLinear,
})
export const MonitorSmartphone = createIcon({
	bold: MonitorSmartphoneBoldWeight,
	boldDuotone: MonitorSmartphoneBoldDuotone,
	linear: MonitorSmartphoneLinear,
})
export const Moon = createIcon({
	bold: MoonBoldWeight,
	boldDuotone: MoonBoldDuotone,
	linear: MoonLinear,
})
export const MoveToFolder = createIcon({
	bold: MoveToFolderBoldWeight,
	boldDuotone: MoveToFolderBoldDuotone,
	linear: MoveToFolderLinear,
})
export const MusicNotes = createIcon({
	bold: MusicNotesBoldWeight,
	boldDuotone: MusicNotesBoldDuotone,
	linear: MusicNotesLinear,
})
export const Palette = createIcon({
	bold: PaletteBoldWeight,
	boldDuotone: PaletteBoldDuotone,
	linear: PaletteLinear,
})
export const PaletteRound = createIcon({
	bold: PaletteRoundBoldWeight,
	boldDuotone: PaletteRoundBoldDuotone,
	linear: PaletteRoundLinear,
})
export const Pause = createIcon({
	bold: PauseBoldWeight,
	boldDuotone: PauseBoldDuotone,
	linear: PauseLinear,
})
export const Pen = createIcon({
	bold: PenBoldWeight,
	boldDuotone: PenBoldDuotone,
	linear: PenLinear,
})
export const PenNewRound = createIcon({
	bold: PenNewRoundBoldWeight,
	boldDuotone: PenNewRoundBoldDuotone,
	linear: PenNewRoundLinear,
})
export const PieChart = createIcon({
	bold: PieChartBoldWeight,
	boldDuotone: PieChartBoldDuotone,
	linear: PieChartLinear,
})
export const Pin = createIcon({
	bold: PinBoldWeight,
	boldDuotone: PinBoldDuotone,
	linear: PinLinear,
})
export const Play = createIcon({
	bold: PlayBoldWeight,
	boldDuotone: PlayBoldDuotone,
	linear: PlayLinear,
})
export const PlugCircle = createIcon({
	bold: PlugCircleBoldWeight,
	boldDuotone: PlugCircleBoldDuotone,
	linear: PlugCircleLinear,
})
export const PlusMinus = createIcon({
	bold: PlusMinusBoldWeight,
	boldDuotone: PlusMinusBoldDuotone,
	linear: PlusMinusLinear,
})
export const Pulse = createIcon({
	bold: PulseBoldWeight,
	boldDuotone: PulseBoldDuotone,
	linear: PulseLinear,
})
export const Refresh = createIcon({
	bold: RefreshBoldWeight,
	boldDuotone: RefreshBoldDuotone,
	linear: RefreshLinear,
})
export const RefreshCircle = createIcon({
	bold: RefreshCircleBoldWeight,
	boldDuotone: RefreshCircleBoldDuotone,
	linear: RefreshCircleLinear,
})
export const Reorder = createIcon({
	bold: ReorderBoldWeight,
	boldDuotone: ReorderBoldDuotone,
	linear: ReorderLinear,
})
export const Repeat = createIcon({
	bold: RepeatBoldWeight,
	boldDuotone: RepeatBoldDuotone,
	linear: RepeatLinear,
})
export const Reply = createIcon({
	bold: ReplyBoldWeight,
	boldDuotone: ReplyBoldDuotone,
	linear: ReplyLinear,
})
export const Restart = createIcon({
	bold: RestartBoldWeight,
	boldDuotone: RestartBoldDuotone,
	linear: RestartLinear,
})
export const Route = createIcon({
	bold: RouteBoldWeight,
	boldDuotone: RouteBoldDuotone,
	linear: RouteLinear,
})
export const Scale = createIcon({
	bold: ScaleBoldWeight,
	boldDuotone: ScaleBoldDuotone,
	linear: ScaleLinear,
})
export const Server = createIcon({
	bold: ServerBoldWeight,
	boldDuotone: ServerBoldDuotone,
	linear: ServerLinear,
})
export const Settings = createIcon({
	bold: SettingsBoldWeight,
	boldDuotone: SettingsBoldDuotone,
	linear: SettingsLinear,
})
export const Share = createIcon({
	bold: ShareBoldWeight,
	boldDuotone: ShareBoldDuotone,
	linear: ShareLinear,
})
export const ShieldCheck = createIcon({
	bold: ShieldCheckBoldWeight,
	boldDuotone: ShieldCheckBoldDuotone,
	linear: ShieldCheckLinear,
})
export const SidebarMinimalistic = createIcon({
	bold: SidebarMinimalisticBoldWeight,
	boldDuotone: SidebarMinimalisticBoldDuotone,
	linear: SidebarMinimalisticLinear,
})
export const SliderHorizontal = createIcon({
	bold: SliderHorizontalBoldWeight,
	boldDuotone: SliderHorizontalBoldDuotone,
	linear: SliderHorizontalLinear,
})
export const Smartphone = createIcon({
	bold: SmartphoneBoldWeight,
	boldDuotone: SmartphoneBoldDuotone,
	linear: SmartphoneLinear,
})
export const Sort = createIcon({
	bold: SortBoldWeight,
	boldDuotone: SortBoldDuotone,
	linear: SortLinear,
})
export const SortByTime = createIcon({
	bold: SortByTimeBoldWeight,
	boldDuotone: SortByTimeBoldDuotone,
	linear: SortByTimeLinear,
})
export const SortHorizontal = createIcon({
	bold: SortHorizontalBoldWeight,
	boldDuotone: SortHorizontalBoldDuotone,
	linear: SortHorizontalLinear,
})
export const SortVertical = createIcon({
	bold: SortVerticalBoldWeight,
	boldDuotone: SortVerticalBoldDuotone,
	linear: SortVerticalLinear,
})
export const Star = createIcon({
	bold: StarBoldWeight,
	boldDuotone: StarBoldDuotone,
	linear: StarLinear,
})
export const Structure = createIcon({
	bold: StructureBoldWeight,
	boldDuotone: StructureBoldDuotone,
	linear: StructureLinear,
})
export const Sun = createIcon({
	bold: SunBoldWeight,
	boldDuotone: SunBoldDuotone,
	linear: SunLinear,
})
export const Tag = createIcon({
	bold: TagBoldWeight,
	boldDuotone: TagBoldDuotone,
	linear: TagLinear,
})
export const Telescope = createIcon({
	bold: TelescopeBoldWeight,
	boldDuotone: TelescopeBoldDuotone,
	linear: TelescopeLinear,
})
export const TestTube = createIcon({
	bold: TestTubeBoldWeight,
	boldDuotone: TestTubeBoldDuotone,
	linear: TestTubeLinear,
})
export const TextFormat = createIcon({
	bold: TextFormatBoldWeight,
	boldDuotone: TextFormatBoldDuotone,
	linear: TextFormatLinear,
})
export const TransferHorizontal = createIcon({
	bold: TransferHorizontalBoldWeight,
	boldDuotone: TransferHorizontalBoldDuotone,
	linear: TransferHorizontalLinear,
})
export const Translation = createIcon({
	bold: TranslationBoldWeight,
	boldDuotone: TranslationBoldDuotone,
	linear: TranslationLinear,
})
export const TrashBinMinimalistic = createIcon({
	bold: TrashBinMinimalisticBoldWeight,
	boldDuotone: TrashBinMinimalisticBoldDuotone,
	linear: TrashBinMinimalisticLinear,
})
export const UndoLeft = createIcon({
	bold: UndoLeftBoldWeight,
	boldDuotone: UndoLeftBoldDuotone,
	linear: UndoLeftLinear,
})
export const UndoLeftRound = createIcon({
	bold: UndoLeftRoundBoldWeight,
	boldDuotone: UndoLeftRoundBoldDuotone,
	linear: UndoLeftRoundLinear,
})
export const UndoRight = createIcon({
	bold: UndoRightBoldWeight,
	boldDuotone: UndoRightBoldDuotone,
	linear: UndoRightLinear,
})
export const UndoRightRound = createIcon({
	bold: UndoRightRoundBoldWeight,
	boldDuotone: UndoRightRoundBoldDuotone,
	linear: UndoRightRoundLinear,
})
export const Upload = createIcon({
	bold: UploadBoldWeight,
	boldDuotone: UploadBoldDuotone,
	linear: UploadLinear,
})
export const User = createIcon({
	bold: UserBoldWeight,
	boldDuotone: UserBoldDuotone,
	linear: UserLinear,
})
export const UserId = createIcon({
	bold: UserIdBoldWeight,
	boldDuotone: UserIdBoldDuotone,
	linear: UserIdLinear,
})
export const UserMinus = createIcon({
	bold: UserMinusBoldWeight,
	boldDuotone: UserMinusBoldDuotone,
	linear: UserMinusLinear,
})
export const UserPlus = createIcon({
	bold: UserPlusBoldWeight,
	boldDuotone: UserPlusBoldDuotone,
	linear: UserPlusLinear,
})
export const UsersGroupRounded = createIcon({
	bold: UsersGroupRoundedBoldWeight,
	boldDuotone: UsersGroupRoundedBoldDuotone,
	linear: UsersGroupRoundedLinear,
})
export const UsersGroupTwoRounded = createIcon({
	bold: UsersGroupTwoRoundedBoldWeight,
	boldDuotone: UsersGroupTwoRoundedBoldDuotone,
	linear: UsersGroupTwoRoundedLinear,
})
export const VideoFrame = createIcon({
	bold: VideoFrameBoldWeight,
	boldDuotone: VideoFrameBoldDuotone,
	linear: VideoFrameLinear,
})
export const Widget2 = createIcon({
	bold: Widget2BoldWeight,
	boldDuotone: Widget2BoldDuotone,
	linear: Widget2Linear,
})
export const Widget5 = createIcon({
	bold: Widget5BoldWeight,
	boldDuotone: Widget5BoldDuotone,
	linear: Widget5Linear,
})
export const WindowFrame = createIcon({
	bold: WindowFrameBoldWeight,
	boldDuotone: WindowFrameBoldDuotone,
	linear: WindowFrameLinear,
})
