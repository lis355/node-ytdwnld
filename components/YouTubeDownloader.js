import { PassThrough } from "node:stream";

import ffmpeg from "fluent-ffmpeg";
import ytdl from "ytdl-core";

import ApplicationComponent from "./app/ApplicationComponent.js";

async function streamToBuffer(readableStream) {
	return new Promise((resolve, reject) => {
		const chunks = [];

		readableStream
			.on("data", data => {
				chunks.push(data);
			})
			.on("end", () => {
				return resolve(Buffer.concat(chunks));
			})
			.on("error", reject);
	});
}

export default class YouTubeDownloader extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		if (!process.env.FFMPEG_PATH) throw new Error("FFMPEG_PATH not set");
		if (!process.env.FFPROBE_PATH) throw new Error("FFPROBE_PATH not set");
		// if (!process.env.YTDL_COOKIE) throw new Error("YTDL_COOKIE not set");
	}

	parseYouTubeId(text) {
		try {
			return ytdl.getURLVideoID(text);
		} catch (_) {
		}

		try {
			return ytdl.getVideoID(text);
		} catch (_) {
		}

		return null;
	}

	async getInfo(youTubeId) {
		return ytdl.getInfo(youTubeId, {
			requestOptions: {
				headers: {
					// cookie: process.env.YTDL_COOKIE
				}
			}
		});
	}

	async downloadYouTubeAudioFromVideo(info) {
		return new Promise(async (resolve, reject) => {
			const video = ytdl.downloadFromInfo(info, { filter: "audioonly" });

			video
				.on("error", reject);

			const bufferStream = new PassThrough();

			ffmpeg(video)
				.audioBitrate(192)
				.format("mp3")
				.on("error", reject)
				.output(bufferStream, { end: true })
				.run();

			const buffer = await streamToBuffer(bufferStream);

			return resolve(buffer);
		});
	}
}
