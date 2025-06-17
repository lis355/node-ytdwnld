import childProcess from "node:child_process";

import LineTransformStream from "line-transform-stream";

import dayjs from "./dayjs.js";

export async function getVersion() {
	let version;

	const ffmpegConvertProcess = childProcess.spawn("ffmpeg", ["-version"]);

	ffmpegConvertProcess.stdout
		.pipe(new LineTransformStream(line => {
			// console.log(line);

			const versionIndex = line.toLowerCase().indexOf("ffmpeg version");
			if (versionIndex >= 0) version = line.substring(versionIndex + 1 + "ffmpeg version".length).split(" ")[0].trim();

			return line;
		}));

	ffmpegConvertProcess.stderr
		.pipe(new LineTransformStream(line => {
			// console.log(line);

			if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

			return line;
		}));

	await new Promise((resolve, reject) => {
		ffmpegConvertProcess.once("exit", () => resolve(version));
		ffmpegConvertProcess.once("error", reject);
	});
}

// return format.approximateDuration.asMinutes() < 40
// 	? this.getAudioStream()
// 	: this.downloadAudioParts();

// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video
// -i pipe:0 -c copy -map 0:a:0 -f adts -f segment -segment_time 30 "out_%03d.aac"  -- extract aac audio segments with 30 sec length from mp4 video, only to files
// -i pipe:0 -b:a 128k -f mp3 pipe:1 -- extract audio channel to mp3

export function getExtractAACAudioFromMP4VideoStream(videoStream, { start, finish }) {
	// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video

	const args = ["-i", "pipe:0", "-c", "copy", "-map", "0:a:0", "-f", "adts"];
	if (start) args.push("-ss", start.asSeconds().toString());
	if (finish) args.push("-t", dayjs.duration(finish - start).asSeconds().toString());
	args.push("pipe:1");

	const ffmpegConvertProcess = childProcess.spawn("ffmpeg", args);

	ffmpegConvertProcess.stderr
		.pipe(new LineTransformStream(line => {
			// console.log(line);

			if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

			return line;
		}));

	videoStream.pipe(ffmpegConvertProcess.stdin);

	return ffmpegConvertProcess.stdout;
}

// async downloadAudioParts() {
// 	const outputFilePath = path.resolve("userData", `${filenamify(videoName)}.${fileExtension}`);
// 	fs.ensureDirSync(path.dirname(outputFilePath));
// }
