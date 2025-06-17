import dayjs from "dayjs";
import dayjsDuration from "dayjs/plugin/duration.js";
import dayjsRelativeTime from "dayjs/plugin/relativeTime.js";

dayjs.extend(dayjsDuration);
dayjs.extend(dayjsRelativeTime);

export default dayjs;
