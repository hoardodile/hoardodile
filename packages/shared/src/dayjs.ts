import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek.js"
import relativeTime from "dayjs/plugin/relativeTime.js"
import timezone from "dayjs/plugin/timezone.js"
import utc from "dayjs/plugin/utc.js"
// Locales used by fromNow() etc. Consumers apply them per instance
// (dayjs(ts).locale("zh-cn")); English is built in.
import "dayjs/locale/zh-cn.js"
import "dayjs/locale/ja.js"
import "dayjs/locale/de.js"
import "dayjs/locale/es.js"

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)
dayjs.extend(relativeTime)

export default dayjs
