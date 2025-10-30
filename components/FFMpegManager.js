import childProcess from "node:child_process";
import path from "node:path";

import LineTransformStream from "line-transform-stream";

import ApplicationComponent from "./app/ApplicationComponent.js";
import dayjs from "../utils/dayjs.js";

export default class FFMpegManager extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		try {
			await this.getVersion();
		} catch (error) {
			console.log("ffmpeg error:", error.message);

			return this.application.exit(1);
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

	async injectMetadataToMP4Video(videoFilePath, metadataFilePath, outputVideoFilePath) {
		const ffmpegProcess = this.createFFMpegProcess(`-i "${videoFilePath}" -i "${metadataFilePath}" -map_metadata 1 -c copy -map 0 -f mp4 -y "${outputVideoFilePath}"`);

		await new Promise((resolve, reject) => {
			ffmpegProcess.once("exit", code => code === 0 ? resolve() : reject(new Error(code.toString())));
			ffmpegProcess.once("error", reject);
		});
	}

	async extractM4AudioFromMP4VideoAndInjectMetadata(videoFilePath, metadataFilePath, outputAudioFilePath) {
		const ffmpegProcess = this.createFFMpegProcess(`-i "${videoFilePath}" -i "${metadataFilePath}" -map_metadata 1 -c copy -map 0:a:0 -f mp4 -y "${outputAudioFilePath}"`);

		await new Promise((resolve, reject) => {
			ffmpegProcess.once("exit", code => code === 0 ? resolve() : reject(new Error(code.toString())));
			ffmpegProcess.once("error", reject);
		});
	}

	async splitM4AudioIntoParts(audioFilePath, outputAudioFilePath, audioDuration, partDuration, outputAudioFilePaths) {
		let processedDuration = dayjs.duration();
		let partIndex = 0;

		while (processedDuration < audioDuration) {
			const startTimeStr = processedDuration.format("HH:mm:ss");
			const durationStr = partDuration.format("HH:mm:ss");

			const outputAudioPartFilePath = `${outputAudioFilePath}.${partIndex}${path.extname(outputAudioFilePath)}`;
			outputAudioFilePaths.push(outputAudioPartFilePath);

			const ffmpegProcess = this.createFFMpegProcess(`-i "${audioFilePath}" -c copy -ss ${startTimeStr} -t ${durationStr} -y "${outputAudioPartFilePath}"`);

			await new Promise((resolve, reject) => {
				ffmpegProcess.once("exit", code => code === 0 ? resolve() : reject(new Error(code.toString())));
				ffmpegProcess.once("error", reject);
			});

			processedDuration = processedDuration.add(partDuration);
			partIndex++;
		}
	}
};
