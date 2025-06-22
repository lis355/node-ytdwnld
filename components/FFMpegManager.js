import childProcess from "node:child_process";
import os from "node:os";
import path from "node:path";
import stream from "node:stream";

import fs from "fs-extra";
import LineTransformStream from "line-transform-stream";

import ApplicationComponent from "./app/ApplicationComponent.js";
import dayjs from "./../utils/dayjs.js";

export default class FFMpegManager extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		try {
			await ffmpeg.getVersion();
		} catch (error) {
			console.log("ffmpeg error:", error.message);

			return process.exit();
		}
	}

	async getVersion() {
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

	getExtractAACAudioFromMP4VideoStream(videoStream, { start, finish }) {
		// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video

		const args = ["-i", "pipe:0", "-c", "copy", "-map", "0:a:0", "-f", "adts"];
		if (start) args.push("-ss", start.asSeconds().toString());
		if (finish) args.push("-t", dayjs.duration(finish - start).asSeconds().toString());
		args.push("pipe:1");

		// console.log(["ffmpeg", ...args].join(" "));

		const ffmpegProcess = childProcess.spawn("ffmpeg", args);

		ffmpegProcess.stderr
			.pipe(new LineTransformStream(line => {
				// console.log(line);

				if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

				return line;
			}));

		videoStream
			.pipe(ffmpegProcess.stdin);

		return ffmpegProcess.stdout;
	}

	getOGGAudioWithMetadataAndChaptersFromMP4VideoStream(videoStream, author, title, chaptersInfo) {
		// ffmpeg -i pipe:0 -c:a libvorbis -q:a 4 -map 0:a:0 -f ogg -metadata:s:a:0 file=metadata.txt pipe:1

		const metadataFilePath = path.resolve(this.application.userDataDirectory, "metadata.txt");

		const metadataLines = [];

		// fs.outputFileSync(metadataFilePath, metadataLines.join(os.EOL));

		const args = ["-i", "pipe:0", "-c:a", "libvorbis", "-b:a", "192k", "-map", "0:a:0", "-f", "ogg", "-metadata:s:a:0", `file="${metadataFilePath}"`];
		if (start) args.push("-ss", start.asSeconds().toString());
		if (finish) args.push("-t", dayjs.duration(finish - start).asSeconds().toString());
		args.push("pipe:1");

		console.log(["ffmpeg", ...args].join(" "));

		const ffmpegProcess = childProcess.spawn("ffmpeg", args);

		ffmpegProcess.stderr
			.pipe(new LineTransformStream(line => {
				// console.log(line);

				if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

				return line;
			}));

		videoStream
			.pipe(ffmpegProcess.stdin);

		ffmpegProcess.on("exit", (code) => {
			fs.removeSync(metadataFilePath);
		});

		return ffmpegProcess.stdout;
	}
};
