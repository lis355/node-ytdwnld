import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import path from "node:path";

import _ from "lodash";
import { decode } from "html-entities";
import moment from "moment";
import sider from "@lis355/sider";
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

const YOUTUBE_ID_TOKEN_HEADER = "x-youtube-identity-token";

export default class YouTubeDownloader extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		if (!process.env.CHROME_PATH) throw new Error("CHROME_PATH not set");
		if (!process.env.FFMPEG_PATH) throw new Error("FFMPEG_PATH not set");

		await this.initializeBrowser();
	}

	async initializeBrowser() {

		const args = new sider.CLIArguments();

		args.parseArrayArguments([
			"--start-maximized",
			"--restore-last-session"
		]);

		args.set("--user-data-dir", path.resolve(process.cwd(), "browserSession"));

		this.browser = new sider.Browser();

		this.browser.on("closed", () => {
			process.exit();
		});

		const options = {
			executablePath: process.env.CHROME_PATH,
			args
		};

		await this.browser.launch(options);

		console.warn("Чтобы залогиниться на Ютубе (в гугле), нужно открыть сначала браузер самому без аргумента --remote-debugging-port, иначе гугл детектит автоматизацию и не дает загрузиться");
		console.log(`${options.executablePath} ${options.args.toArray().join(" ")}`);

		await this.browser.initialize();

		this.page = await new Promise(resolve => {
			this.browser.once("pageAdded", page => {
				page.network.requestHandler = params => {
					if (params.request.url.includes("youtube.com")) {
						Object.keys(params.request.headers).forEach(name => {
							if (name.toLowerCase() === YOUTUBE_ID_TOKEN_HEADER) this.idTokenHeader = params.request.headers[name];
						});
					}
				};

				return resolve(page);
			});
		});

		const url = "https://www.youtube.com/";
		await this.page.navigate(url);
		await this.page.waitForNavigation(url);
	}

	async run() {
		await super.run();
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
		await this.navigateBrowserAndUpdateCookies(youTubeId);

		const info = await ytdl.getInfo(youTubeId, {
			requestOptions: {
				headers: {
					cookie: this.cookiesString,
					YOUTUBE_ID_TOKEN_HEADER: this.idTokenHeader
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

	async navigateBrowserAndUpdateCookies(youTubeId) {
		const url = `https://www.youtube.com/watch?v=${youTubeId}`;
		await this.page.navigate(url);
		await this.page.waitForNavigation(url);

		const { cookies } = await this.page.cdp.send("Network.getCookies");
		this.cookiesString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
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
