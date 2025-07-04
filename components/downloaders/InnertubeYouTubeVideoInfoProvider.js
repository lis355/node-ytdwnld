import path from "node:path";
import stream from "node:stream";

// import { socksDispatcher } from "fetch-socks";
// import fs from "fs-extra";
import * as bgutils from "bgutils-js";
import * as jsdom from "jsdom";
import * as youtubei from "youtubei.js";
import getYouTubeID from "get-youtube-id";
import undici from "undici";

import ApplicationComponent from "../app/ApplicationComponent.js";
import dayjs from "../../utils/dayjs.js";

// https://github.com/LuanRT/BgUtils/blob/main/examples/node/innertube-challenge-fetcher-example.ts

// use for fetch overriding
youtubei.Utils.Platform.shim.fetch = undici.fetch;
youtubei.Utils.Platform.shim.Request = undici.Request;
youtubei.Utils.Platform.shim.Response = undici.Response;

// HACK for hide parser warning message
youtubei.Parser.setParserErrorHandler(error => {
	// console.error(error);
});

function capitalize(str) {
	return str.substring(0, 1).toUpperCase() + str.substring(1);
}

const userAgent = bgutils.USER_AGENT;

export default class InnertubeYouTubeVideoInfoProvider extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		try {
			await this.createInnertube({ withPlayer: true, generateSessionLocally: true, userAgent });
			await this.createIntegrityTokenBasedMinter();
		} catch (error) {
			console.log("Check acess to youtube.com (may be you need VPN or proxy)");
			console.log("Innertube error:", error.message);

			return process.exit();
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
		// this.proxyAgent = new undici.ProxyAgent({
		// 	uri: "socks5://localhost:1080"
		// 	// token: `Basic ${Buffer.from(`${your_proxy_username}:${your_proxy_password}`).toString("base64")}`
		// });

		// this.proxyAgent = socksDispatcher({
		// 	type: 5,
		// 	host: "127.0.0.1",
		// 	port: 1080

		// 	//userId: "username",
		// 	//password: "password",
		// });

		this.innertube = await youtubei.Innertube.create({
			"enable_session_cache": false,
			"user_agent": navigator.userAgent,

			"retrieve_player": withPlayer,
			"location": location,
			"enable_safety_mode": safetyMode,
			"client_type": clientType,

			fetch: (input, init) => {
				// console.log("[InnertubeYouTubeVideoInfoProvider] fetch:", input.url ? input.url.toString() : input.toString());

				return undici.fetch(input, {
					// dispatcher: this.proxyAgent,
					...init
				});
			},

			"user_agent": userAgent,

			"cache": withPlayer ? new youtubei.UniversalCache(false, path.resolve(this.application.userDataDirectory, "innertubeCache")) : undefined,
			"enable_session_cache": true,

			"generate_session_locally": true
		});
	}

	async createIntegrityTokenBasedMinter() {
		const virtualConsole = new jsdom.VirtualConsole();
		virtualConsole.on("error", () => { });
		virtualConsole.on("warn", () => { });
		virtualConsole.on("info", () => { });
		virtualConsole.on("dir", () => { });

		const dom = new jsdom.JSDOM("<!DOCTYPE html><html lang=\"en\"><head><title></title></head><body></body></html>", {
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
		const bgScriptResponse = await undici.fetch(`https:${interpreterUrl}`);
		const interpreterJavascript = await bgScriptResponse.text();

		if (interpreterJavascript) {
			new Function(interpreterJavascript)();
		} else throw new Error("Could not load VM");

		const botguard = await bgutils.BG.BotGuardClient.create({
			program: challengeResponse.bg_challenge.program,
			globalName: challengeResponse.bg_challenge.global_name,
			globalObj: globalThis
		});

		const webPoSignalOutput = [];
		const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
		const requestKey = "O43z0dpjhgX20SCx4KAo";

		const integrityTokenResponse = await undici.fetch(bgutils.buildURL("GenerateIT", true), {
			method: "POST",
			headers: {
				"content-type": "application/json+protobuf",
				"x-goog-api-key": bgutils.GOOG_API_KEY,
				"x-user-agent": "grpc-web-javascript/0.1",
				"user-agent": userAgent
			},
			body: JSON.stringify([requestKey, botguardResponse])
		});

		const integrityToken = await integrityTokenResponse.json();

		if (typeof integrityToken[0] !== "string") throw new Error("Could not get integrity token");

		this.integrityTokenBasedMinter = await bgutils.BG.WebPoMinter.create({ integrityToken: integrityToken[0] }, webPoSignalOutput);
	}

	async generatePoTokens(videoId) {
		const contentPoToken = await this.integrityTokenBasedMinter.mintAsWebsafeString(videoId);
		const sessionPoToken = await this.integrityTokenBasedMinter.mintAsWebsafeString(this.innertube.session.context.client.visitorData || "");

		return { contentPoToken, sessionPoToken };
	}

	parseVideoId(text) {
		if (/^[^#\&\?]{11}$/.test(text)) return text;

		const videoId = getYouTubeID((text || "").trim());
		if (!videoId) throw new Error("Bad url or text");

		return videoId;
	}

	async getVideoInfo(videoId) {
		const { contentPoToken, sessionPoToken } = await this.generatePoTokens(videoId);

		try {
			this.innertube.session["po_token"] = contentPoToken;
			this.innertube.session.player["po_token"] = sessionPoToken;
		} catch (error) {
			console.error("Local API, poToken generation failed", error);

			throw error;
		}

		const info = await this.innertube.getInfo(videoId);
		const mwebInfo = await this.innertube.getBasicInfo(videoId, "MWEB");

		// fs.outputFileSync(path.resolve(this.application.userDataDirectory, "info.json"), JSON.stringify({ info, mwebInfo }, null, "\t"));

		if (mwebInfo["playability_status"].status !== "OK" ||
			!mwebInfo["streaming_data"]) throw new Error("Bad playability status");

		info["playability_status"] = mwebInfo["playability_status"];
		info["streaming_data"] = mwebInfo["streaming_data"];

		// let hasTrailer = info.has_trailer;
		// let trailerIsAgeRestricted = info.getTrailerInfo() === null;

		// if (
		// 	((info.playability_status.status === "UNPLAYABLE" || info.playability_status.status === "LOGIN_REQUIRED") &&
		// 		info.playability_status.reason === "Sign in to confirm your age") ||
		// 	(hasTrailer && trailerIsAgeRestricted)
		// ) {
		// 	const webEmbeddedInnertube = await createInnertube({ clientType: ClientType.WEB_EMBEDDED });
		// 	webEmbeddedInnertube.session.context.client.visitorData = this.innertube.session.context.client.visitorData;

		// 	if (contentPoToken) webEmbeddedInnertube.session.po_token = contentPoToken;

		// 	const videoId = hasTrailer && trailerIsAgeRestricted ? info.playability_status.error_screen.video_id : videoId;

		// 	webEmbeddedInnertube.session.player = this.innertube.session.player;

		// 	const bypassedInfo = await webEmbeddedInnertube.getBasicInfo(videoId, "WEB_EMBEDDED");

		// 	if (bypassedInfo.playability_status.status === "OK" && bypassedInfo["streaming_data"]) {
		// 		info.playability_status = bypassedInfo.playability_status;
		// 		info["streaming_data"] = bypassedInfo["streaming_data"];
		// 		info.basic_info.start_timestamp = bypassedInfo.basic_info.start_timestamp;
		// 		info.basic_info.duration = bypassedInfo.basic_info.duration;
		// 		info.captions = bypassedInfo.captions;
		// 		info.storyboards = bypassedInfo.storyboards;

		// 		hasTrailer = false;
		// 		trailerIsAgeRestricted = false;
		// 	}
		// }

		// if ((info.playability_status.status === "UNPLAYABLE" && (!hasTrailer || trailerIsAgeRestricted)) ||
		// 	info.playability_status.status === "LOGIN_REQUIRED") {
		// 	return info;
		// }

		// if (hasTrailer) {
		// 	const trailerScreen = info.playability_status.error_screen;
		// 	const trailerInfo = new Mixins.MediaInfo([{ data: trailerScreen.trailer.player_response }]);

		// 	info.playability_status = trailerInfo.playability_status;
		// 	info["streaming_data"] = trailerInfo["streaming_data"];
		// 	info.basic_info.start_timestamp = trailerInfo.basic_info.start_timestamp;
		// 	info.basic_info.duration = trailerInfo.basic_info.duration;
		// 	info.captions = trailerInfo.captions;
		// 	info.storyboards = trailerInfo.storyboards;
		// }

		// function decipherFormats(formats, player) {
		// 	for (const format of formats) format.url = format.decipher(player);
		// }

		// if (info["streaming_data"]) {
		// 	decipherFormats(info["streaming_data"].formats, this.innertube.session.player);

		// 	const firstFormat = info["streaming_data"]["adaptive_formats"][0];

		// 	if (firstFormat.url ||
		// 		firstFormat["signature_cipher"] ||
		// 		firstFormat.cipher) {
		// 		decipherFormats(info["streaming_data"]["adaptive_formats"], this.innertube.session.player);
		// 	}

		// 	// if (info["streaming_data"].dash_manifest_url) {
		// 	// 	let url = info["streaming_data"].dash_manifest_url;

		// 	// 	if (url.includes("?")) {
		// 	// 		url += `&pot=${encodeURIComponent(sessionPoToken)}&mpd_version=7`;
		// 	// 	} else {
		// 	// 		url += `${url.endsWith("/") ? "" : "/"}pot/${encodeURIComponent(sessionPoToken)}/mpd_version/7`;
		// 	// 	}

		// 	// 	info["streaming_data"].dash_manifest_url = url;
		// 	// }
		// }

		const { id, author, title } = info["basic_info"];

		const videoInfo = {
			meta: {
				info,
				mwebInfo
			},

			id,
			author,
			title,

			formats: [...info["streaming_data"].formats, ...info["streaming_data"]["adaptive_formats"]].map(format => ({
				type: format["has_video"] ? "video" : "audio",
				quality: format["quality_label"],
				videoQuality: format["quality"],
				audioQuality: format["audio_quality"],
				size: format["content_length"],
				codec: format["mime_type"],
				approximateDuration: dayjs.duration(format["approx_duration_ms"]),
				url: format["url"]
			}))
		};

		if (info.captions &&
			info.captions["caption_tracks"] &&
			info.captions["caption_tracks"][0]) {

			const captionsUrl = new URL(info.captions["caption_tracks"][0]["base_url"]);
			captionsUrl.searchParams.set("fmt", "srt");

			videoInfo.subtitles = {
				url: captionsUrl.href
			};
		}

		videoInfo.timings = info["basic_info"]["short_description"]
			.split("\n")
			.map(s => s.trim())
			.filter(Boolean)
			.map(line => {
				const match = line.match(/^\d+(:\d+)+/);
				if (!match) return null;

				const spaceIndex = match.index + match[0].length;

				const timeParts = line.substring(0, spaceIndex).split(":").map(parseFloat).filter(Number.isFinite);

				let timing;
				if (timeParts.length === 3) timing = dayjs.duration({ hours: timeParts[0], minutes: timeParts[1], seconds: timeParts[2] });
				else if (timeParts.length === 2) timing = dayjs.duration({ hours: 0, minutes: timeParts[0], seconds: timeParts[1] });
				else if (timeParts.length === 1) timing = dayjs.duration({ hours: 0, minutes: 0, seconds: timeParts[0] });
				else return null;

				let caption = line.substring(spaceIndex).trim();
				while (caption.startsWith("-")) caption = caption.substring(1).trim();
				caption = capitalize(caption);

				return {
					timing,
					caption
				};
			})
			.filter(Boolean);

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

		return videoInfo;
	}

	async getMediaStreamInfo(videoInfo, options) {
		const format = videoInfo.meta.info.chooseFormat(options);
		format.type = format["mime_type"];
		format.size = format["content_length"];

		return format;
	}

	async getMediaStream(videoInfo, options) {
		return stream.Readable.fromWeb(await videoInfo.meta.info.download(options));
	}

	async getSubtitlesStream(videoInfo) {
		const response = await videoInfo.meta.info.actions.session.http.fetch_function(videoInfo.subtitles.url, {
			method: "GET",
			headers: youtubei.Constants.STREAM_HEADERS,
			redirect: "follow"
		});

		if (!response.ok ||
			!response.body) throw new Error("Can't get subtitles");

		return stream.Readable.fromWeb(response.body);
	}
}
