import childProcess from "node:child_process";

import LineTransformStream from "line-transform-stream";

import dayjs from "./dayjs.js";

// return format.approximateDuration.asMinutes() < 40
// 	? this.getAudioStream()
// 	: this.downloadAudioParts();

// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video
// -i pipe:0 -c copy -map 0:a:0 -f adts -f segment -segment_time 30 "out_%03d.aac"  -- extract aac audio segments with 30 sec length from mp4 video, only to files
// -i pipe:0 -b:a 128k -f mp3 pipe:1 -- extract audio channel to mp3

export function ffmpegGetExtractAACAudioFromMP4VideoStream(videoStream, { start, finish }) {
	// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video

	const args = ["-i", "pipe:0", "-c", "copy", "-map", "0:a:0", "-f", "adts", "pipe:1"];
	if (start) args.push("-ss", start.asSeconds().toString());
	if (finish) args.push("-t", dayjs.duration(finish - start).asSeconds().toString());

	const ffmpegConvertProcess = childProcess.spawn("ffmpeg", args);

	ffmpegConvertProcess.stderr
		.pipe(new LineTransformStream(line => {
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