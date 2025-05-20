import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import stream from "node:stream";

import { BG, buildURL, GOOG_API_KEY, USER_AGENT } from "bgutils-js";
import { ClientType, Innertube, Mixins, UniversalCache } from "youtubei.js";
import { JSDOM, VirtualConsole } from "jsdom";
import { setParserErrorHandler as innertubeSetParserErrorHandler } from "./node_modules/youtubei.js/dist/src/parser/parser.js";
import byteSize from "byte-size";
import cliProgress from "cli-progress";
import filenamify from "filenamify";
import fs from "fs-extra";
import LineTransformStream from "line-transform-stream";

import YouTubeDownloader from "./YouTubeDownloader.js";

// https://github.com/LuanRT/BgUtils/blob/main/examples/node/innertube-challenge-fetcher-example.ts

const userAgent = USER_AGENT;

// HACK for hide parser warning message
innertubeSetParserErrorHandler(error => {
	// console.error(error);
});

export default class InnertubeYouTubeDownloader extends YouTubeDownloader {
	async initialize() {
		await super.initialize();

		if (!process.env.FFMPEG_PATH) throw new Error("FFMPEG_PATH not set");

		this.innertube = await createInnertube({ withPlayer: true, generateSessionLocally: true, userAgent });

		({ contentPoToken: this.contentPoToken, sessionPoToken: this.contentPoToken } = await generatePoTokens());

		try {
			this.innertube.session.po_token = contentPoToken;
			this.innertube.session.player.po_token = sessionPoToken;
		} catch (error) {
			console.error("Local API, poToken generation failed", error);

			throw error;
		}
	}

	async createInnertube({
		withPlayer = false,
		userAgent = undefined,
		location = undefined,
		safetyMode = false,
		clientType = undefined
		// generateSessionLocally = true
	} = {}) {
		return Innertube.create({
			"enable_session_cache": false,
			"user_agent": navigator.userAgent,

			"retrieve_player": withPlayer,
			"location": location,
			"enable_safety_mode": safetyMode,
			"client_type": clientType,

			// fetch: (input, init) => fetch(input, init),

			"user_agent": userAgent,

			"cache": withPlayer ? new UniversalCache(false) : undefined,
			"enable_session_cache": true,

			"generate_session_locally": true
		});
	}

	async generatePoTokens() {
		const virtualConsole = new VirtualConsole();
		virtualConsole.on("error", () => { });
		virtualConsole.on("warn", () => { });
		virtualConsole.on("info", () => { });
		virtualConsole.on("dir", () => { });

		const dom = new JSDOM("<!DOCTYPE html><html lang=\"en\"><head><title></title></head><body></body></html>", {
			url: "https://www.youtube.com/",
			referrer: "https://www.youtube.com/",
			userAgent,
			virtualConsole
		});

		Object.assign(globalThis, {
			window: dom.window,
			document: dom.window.document,
			location: dom.window.location,
			origin: dom.window.origin
		});

		if (!Reflect.has(globalThis, "navigator")) Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator });

		const challengeResponse = await this.innertube.getAttestationChallenge("ENGAGEMENT_TYPE_UNBOUND");

		if (!challengeResponse.bg_challenge) throw new Error("Could not get challenge");

		const interpreterUrl = challengeResponse.bg_challenge.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
		const bgScriptResponse = await fetch(`https:${interpreterUrl}`);
		const interpreterJavascript = await bgScriptResponse.text();

		if (interpreterJavascript) {
			new Function(interpreterJavascript)();
		} else throw new Error("Could not load VM");

		const botguard = await BG.BotGuardClient.create({
			program: challengeResponse.bg_challenge.program,
			globalName: challengeResponse.bg_challenge.global_name,
			globalObj: globalThis
		});

		const webPoSignalOutput = [];
		const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
		const requestKey = "O43z0dpjhgX20SCx4KAo";

		const integrityTokenResponse = await fetch(buildURL("GenerateIT", true), {
			method: "POST",
			headers: {
				"content-type": "application/json+protobuf",
				"x-goog-api-key": GOOG_API_KEY,
				"x-user-agent": "grpc-web-javascript/0.1",
				"user-agent": userAgent
			},
			body: JSON.stringify([requestKey, botguardResponse])
		});

		const integrityToken = await integrityTokenResponse.json();

		if (typeof integrityToken[0] !== "string") throw new Error("Could not get integrity token");

		const integrityTokenBasedMinter = await BG.WebPoMinter.create({ integrityToken: integrityToken[0] }, webPoSignalOutput);
		const contentPoToken = await integrityTokenBasedMinter.mintAsWebsafeString(videoId);
		const visitorData = this.innertube.session.context.client.visitorData || "";
		const sessionPoToken = await integrityTokenBasedMinter.mintAsWebsafeString(visitorData);

		return { contentPoToken, sessionPoToken };
	}

	async getVideoInfo(videoId) {
		const contentPoToken = this.innertube.session.po_token;
		const sessionPoToken = this.innertube.session.player.po_token;

		const info = await this.innertube.getInfo(videoId);

		const mwebInfo = await this.innertube.getBasicInfo(videoId, "MWEB");

		if (mwebInfo.playability_status.status === "OK" && mwebInfo.streaming_data) {
			info.playability_status = mwebInfo.playability_status;
			info.streaming_data = mwebInfo.streaming_data;
		}

		let hasTrailer = info.has_trailer;
		let trailerIsAgeRestricted = info.getTrailerInfo() === null;

		if (
			((info.playability_status.status === "UNPLAYABLE" || info.playability_status.status === "LOGIN_REQUIRED") &&
				info.playability_status.reason === "Sign in to confirm your age") ||
			(hasTrailer && trailerIsAgeRestricted)
		) {
			const webEmbeddedInnertube = await createInnertube({ clientType: ClientType.WEB_EMBEDDED });
			webEmbeddedInnertube.session.context.client.visitorData = this.innertube.session.context.client.visitorData;

			if (contentPoToken) webEmbeddedInnertube.session.po_token = contentPoToken;

			const videoId = hasTrailer && trailerIsAgeRestricted ? info.playability_status.error_screen.video_id : videoId;

			webEmbeddedInnertube.session.player = this.innertube.session.player;

			const bypassedInfo = await webEmbeddedInnertube.getBasicInfo(videoId, "WEB_EMBEDDED");

			if (bypassedInfo.playability_status.status === "OK" && bypassedInfo.streaming_data) {
				info.playability_status = bypassedInfo.playability_status;
				info.streaming_data = bypassedInfo.streaming_data;
				info.basic_info.start_timestamp = bypassedInfo.basic_info.start_timestamp;
				info.basic_info.duration = bypassedInfo.basic_info.duration;
				info.captions = bypassedInfo.captions;
				info.storyboards = bypassedInfo.storyboards;

				hasTrailer = false;
				trailerIsAgeRestricted = false;
			}
		}

		if ((info.playability_status.status === "UNPLAYABLE" && (!hasTrailer || trailerIsAgeRestricted)) ||
			info.playability_status.status === "LOGIN_REQUIRED") {
			return info;
		}

		if (hasTrailer) {
			const trailerScreen = info.playability_status.error_screen;
			const trailerInfo = new Mixins.MediaInfo([{ data: trailerScreen.trailer.player_response }]);

			info.playability_status = trailerInfo.playability_status;
			info.streaming_data = trailerInfo.streaming_data;
			info.basic_info.start_timestamp = trailerInfo.basic_info.start_timestamp;
			info.basic_info.duration = trailerInfo.basic_info.duration;
			info.captions = trailerInfo.captions;
			info.storyboards = trailerInfo.storyboards;
		}

		function decipherFormats(formats, player) {
			for (const format of formats) format.freeTubeUrl = format.decipher(player);
		}

		if (info.streaming_data) {
			decipherFormats(info.streaming_data.formats, this.innertube.session.player);

			const firstFormat = info.streaming_data.adaptive_formats[0];

			if (firstFormat.url || firstFormat.signature_cipher || firstFormat.cipher) {
				decipherFormats(info.streaming_data.adaptive_formats, this.innertube.session.player);
			}

			if (info.streaming_data.dash_manifest_url) {
				let url = info.streaming_data.dash_manifest_url;

				if (url.includes("?")) {
					url += `&pot=${encodeURIComponent(sessionPoToken)}&mpd_version=7`;
				} else {
					url += `${url.endsWith("/") ? "" : "/"}pot/${encodeURIComponent(sessionPoToken)}/mpd_version/7`;
				}

				info.streaming_data.dash_manifest_url = url;
			}
		}

		return info;

		// await this.navigateBrowserAndUpdateCookies(youTubeId);

		// const info = await ytdl.getInfo(youTubeId, {
		// 	requestOptions: {
		// 		headers: {
		// 			cookie: this.cookiesString,
		// 			YOUTUBE_ID_TOKEN_HEADER: this.idTokenHeader
		// 		},
		// 		agent: this.proxyAgent
		// 	}
		// });

		// info.videoDetails.duration = moment.duration(info.videoDetails.lengthSeconds, "seconds");

		// if (info.videoDetails.chapters) {
		// 	info.videoDetails.chapters.forEach(chapter => {
		// 		chapter.startTime = moment.duration(chapter.start_time, "seconds");
		// 	});
		// }

		// return info;
	}

	async downloadYouTubeAudioFromVideo(info) {
		// return new Promise(async (resolve, reject) => {
		// 	const video = ytdl.downloadFromInfo(info, { filter: "audioonly" });

		// 	video.on("error", reject);

		// 	const bufferStream = new PassThrough();

		// 	const child = spawn(`"${process.env.FFMPEG_PATH}" -v quiet -i pipe:0 -b:a 128k -f mp3 pipe:1`, { shell: true });

		// 	child.stderr.on("data", data => {
		// 		const line = data.toString();

		// 		console.error(line);
		// 	});

		// 	child.stdout.pipe(bufferStream);

		// 	video.pipe(child.stdin);

		// 	const buffer = await streamToBuffer(bufferStream);

		// 	return resolve(buffer);
		// });

		const info = await getVideoInfo(videoId);
		const videoName = `${info["basic_info"].author} - ${info["basic_info"].title}`;
		console.log(videoName);

		const format = info["streaming_data"]["formats"][0];

		// const format = info["streaming_data"]["adaptive_formats"]
		// 	.find(format => format["mime_type"].startsWith("audio/mp4") &&
		// 		format["audio_quality"] === "AUDIO_QUALITY_MEDIUM");

		let fileExtension = format["mime_type"].split("/")[1].toLowerCase();
		if (fileExtension.indexOf(";") > 0) fileExtension = fileExtension.substring(0, fileExtension.indexOf(";"));
		if (fileExtension.indexOf(" ") > 0) fileExtension = fileExtension.substring(0, fileExtension.indexOf(" "));

		const url = format.freeTubeUrl;
		const streamResponse = await fetch(url);

		const outputFilePath = path.resolve("userData", `${filenamify(videoName)}.${fileExtension}`);
		fs.ensureDirSync(path.dirname(outputFilePath));

		const contentLength = Number(streamResponse.headers.get("content-length"));
		let downloadedLength = 0;

		const downloadProgressBar = new cliProgress.SingleBar({
			hideCursor: true,
			barCompleteChar: "\u2588",
			barIncompleteChar: "\u2591",
			barsize: 80,
			formatValue: value => byteSize(value),
			format: (options, params, payload) => `${cliProgress.Format.BarFormat(params.progress, options)}| ${(params.progress * 100).toFixed(2).padStart(6, "0")}% | ${options.formatValue(params.value)} / ${options.formatValue(params.total)}`
		});

		// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video
		// -i pipe:0 -c copy -map 0:a:0 -f adts -f segment -segment_time 30 "out_%03d.aac"  -- extract aac audio segments with 30 sec length from mp4 video, only to files
		// -i pipe:0 -b:a 128k -f mp3 pipe:1 -- extract audio channel to mp3

		const ffmpegConvertProcess = spawn(`"${process.env.FFMPEG_PATH}" -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1`, { shell: true });

		ffmpegConvertProcess.stderr
			.pipe(new LineTransformStream(line => {
				if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

				return line;
			}));

		await Promise.all([
			pipeline(
				stream.Readable.fromWeb(streamResponse.body),
				new stream.Transform({
					transform(chunk, encoding, callback) {
						downloadedLength += chunk.byteLength;
						downloadProgressBar.update(downloadedLength, {});

						this.push(chunk);
						callback();
					}
				})
					.once("pipe", () => {
						downloadProgressBar.start(contentLength, 0);
					})
					.once("end", () => {
						downloadProgressBar.stop();
					}),
				// fs.createWriteStream(path.resolve("userData", "out.aac")),
				// fs.createReadStream(path.resolve("userData", "out.aac"))
				ffmpegConvertProcess.stdin
			),
			pipeline(
				ffmpegConvertProcess.stdout,
				fs.createWriteStream(outputFilePath)
			)
		]);
	}

	async downloadYouTubeSubtitlesFromVideo(info) {
		// const subtitlesUrl = _.get(info, "player_response.captions.playerCaptionsTracklistRenderer.captionTracks.0.baseUrl");
		// if (!subtitlesUrl) return null;

		// const xmlSubtitles = await new Promise(async (resolve, reject) => {
		// 	fetch(subtitlesUrl)
		// 		.then(response => response.text())
		// 		.then(resolve)
		// 		.catch(reject);
		// });

		// const subtitles = await xml2js.parseStringPromise(xmlSubtitles);
		// const rawText = subtitles.transcript.text.map(item => item._).join(" ");
		// const text = decode(rawText);

		// return text;
	}
}
