// https://www.matroska.org/technical/subtitles.html#srt-subtitles

import dayjs from "./dayjs.js";

export default class SRTParser {
	static parse(str) {
		if (typeof str !== "string") throw new Error("Expected string");

		const subtitles = [];

		const lines = str.split("\n").map(line => line.trim());

		let index = 0;
		while (index + 3 < lines.length) {
			const subtitle = SRTParser.parseSubtitleBlock(lines, index);
			subtitles.push(subtitle);

			index += subtitle.text.length + 3;
		}

		while (index < lines.length &&
			lines[index] === "") index++;

		if (index < lines.length) throw new Error(`Bad subtitle block on line ${lines[index]}`);

		return subtitles;
	}

	static parseSubtitleBlock(lines, startIndex) {
		if (startIndex + 3 >= lines.length) throw new Error("Bad subtitle block");

		const subtitle = {
			index: Number(lines[startIndex]),
			time: [],
			text: []
		};

		const timeLine = lines[startIndex + 1];
		const timeMatch = timeLine.match(/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/);
		if (!timeMatch) throw new Error(`Bad subtitle block on line ${lines[startIndex]}`);

		subtitle.time.push(SRTParser.parseTime(timeMatch[1]), SRTParser.parseTime(timeMatch[2]));

		let textIndex = startIndex + 2;
		while (textIndex < lines.length &&
			lines[textIndex] !== "") {
			subtitle.text.push(lines[textIndex]);

			textIndex++;
		}

		return subtitle;
	}

	static parseTime(timeString) {
		const [hours, minutes, seconds] = timeString.split(":");
		const [secs, ms] = seconds.split(",");

		return dayjs.duration({ hours: Number(hours), minutes: Number(minutes), seconds: Number(secs), milliseconds: Number(ms) });
	}

	static format(subtitles) {
		return subtitles
			.map(subtitle =>
				[
					subtitle.index,
					subtitle.time.map(SRTParser.formatTime).join(" --> "),
					...subtitle.text
				].join("\n") + "\n\n"
			)
			.join("");
	}

	static formatTime(time) {
		return time.format("HH:mm:ss,SSS");
	}
}
