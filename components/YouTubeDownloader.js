import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";

import _ from "lodash";
import { decode } from "html-entities";
import moment from "moment";
import xml2js from "xml2js";
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
		const info = await ytdl.getInfo(youTubeId, {
			requestOptions: {
				headers: {
					// cookie: process.env.YTDL_COOKIE
				}
			}
		});

		info.videoDetails.duration = moment.duration(info.videoDetails.lengthSeconds, "seconds");

		if (info.videoDetails.chapters) {
			info.videoDetails.chapters.forEach(chapter => {
				chapter.startTime = moment.duration(chapter.start_time, "seconds");
			});
		}

		return info;
	}

	async downloadYouTubeAudioFromVideo(info) {
		return new Promise(async (resolve, reject) => {
			const video = ytdl.downloadFromInfo(info, { filter: "audioonly" });

			video.on("error", reject);

			const bufferStream = new PassThrough();

			const child = spawn(`"${process.env.FFMPEG_PATH}" -v quiet -i pipe:0 -b:a 128k -f mp3 pipe:1`, { shell: true });

			child.stderr.on("data", data => {
				const line = data.toString();

				console.error(line);
			});

			child.stdout.pipe(bufferStream);

			video.pipe(child.stdin);

			const buffer = await streamToBuffer(bufferStream);

			return resolve(buffer);
		});
	}

	async downloadYouTubeSubtitlesFromVideo(info) {
		const subtitlesUrl = _.get(info, "player_response.captions.playerCaptionsTracklistRenderer.captionTracks.0.baseUrl");
		if (!subtitlesUrl) return null;

		const xmlSubtitles = await new Promise(async (resolve, reject) => {
			fetch(subtitlesUrl)
				.then(response => response.text())
				.then(resolve)
				.catch(reject);
		});

		const subtitles = await xml2js.parseStringPromise(xmlSubtitles);
		const rawText = subtitles.transcript.text.map(item => item._).join(" ");
		const text = decode(rawText);

		return text;
	}
}
