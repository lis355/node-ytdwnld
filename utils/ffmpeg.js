import childProcess from "node:child_process";
import stream from "node:stream";

import LineTransformStream from "line-transform-stream";

import dayjs from "./dayjs.js";

export async function getVersion() {
	let version;

	const ffmpegProcess = childProcess.spawn("ffmpeg", ["-version"]);

	ffmpegProcess.stdout
		.pipe(new LineTransformStream(line => {
			// console.log(line);

			const versionIndex = line.toLowerCase().indexOf("ffmpeg version");
			if (versionIndex >= 0) {
				try {
					version = line.substring(versionIndex + 1 + "ffmpeg version".length).split(" ")[0].trim();
				} catch (_) {
				}
			}

			return line;
		}));

	ffmpegProcess.stderr
		.pipe(new LineTransformStream(line => {
			// console.log(line);

			if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

			return line;
		}));

	await new Promise((resolve, reject) => {
		ffmpegProcess.once("exit", () => version ? resolve(version) : reject(new Error("Bad version")));
		ffmpegProcess.once("error", reject);
	});
}

// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video
// -i pipe:0 -b:a 128k -f mp3 pipe:1 -- extract audio channel to mp3

export function getExtractAACAudioFromMP4VideoStream(videoStream, { start, finish }) {
	// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video

	const args = ["-i", "pipe:0", "-c", "copy", "-map", "0:a:0", "-f", "adts"];
	if (start) args.push("-ss", start.asSeconds().toString());
	if (finish) args.push("-t", dayjs.duration(finish - start).asSeconds().toString());
	args.push("pipe:1");

	const ffmpegProcess = childProcess.spawn("ffmpeg", args);

	ffmpegProcess.stderr
		.pipe(new LineTransformStream(line => {
			// console.log(line);

			if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

			return line;
		}));

	videoStream
		.pipe(new stream.PassThrough()
			.on("data", chunk => {

			})
		)
		.pipe(ffmpegProcess.stdin);


	ffmpegProcess.on('exit', (code) => {
		// console.error(`Child process exited with code ${code}`);
	});
	ffmpegProcess.stdin.on("finish", () => {

	})

	return ffmpegProcess.stdout;
}
