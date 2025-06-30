import childProcess from "node:child_process";

import LineTransformStream from "line-transform-stream";

import ApplicationComponent from "./app/ApplicationComponent.js";
import dayjs from "./../utils/dayjs.js";

export default class FFMpegManager extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		try {
			await this.getVersion();
		} catch (error) {
			console.log("ffmpeg error:", error.message);

			return process.exit();
		}
	}

	createFFMpegProcess(args) {
		const cmd = `ffmpeg -hide_banner ${args}`;

		// console.log("[FFMpegManager]:", cmd);

		const ffmpegProcess = childProcess.exec(cmd);

		ffmpegProcess.stderr
			.pipe(new LineTransformStream(line => {
				// console.log("ffmpeg:", line);

				if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

				return line;
			}));

		return ffmpegProcess;
	}

	async getVersion() {
		let version;

		const ffmpegProcess = this.createFFMpegProcess("-version");

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

		await new Promise((resolve, reject) => {
			ffmpegProcess.once("exit", () => version ? resolve(version) : reject(new Error("Bad version")));
			ffmpegProcess.once("error", reject);
		});
	}

	async extractAACAudioFromMP4VideoStream(videoFilePath, metadataFilePath, outputAudioFilePath) {
		const ffmpegProcess = this.createFFMpegProcess(`-i "${videoFilePath}" -i "${metadataFilePath}" -map_metadata 1 -c copy -map 0:a:0 -f mp4 -y "${outputAudioFilePath}"`);

		await new Promise((resolve, reject) => {
			ffmpegProcess.once("exit", code => code === 0 ? resolve() : reject(new Error(code.toString())));
			ffmpegProcess.once("error", reject);
		});
	}
};
