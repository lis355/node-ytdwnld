import path from "node:path";
import stream from "node:stream";

// import fs from "fs-extra";
import { socksDispatcher } from "fetch-socks";
import * as bgutils from "bgutils-js";
import * as jsdom from "jsdom";
import * as youtubei from "youtubei.js";
import undici from "undici";

import ApplicationComponent from "../app/ApplicationComponent.js";
import dayjs from "../../utils/dayjs.js";

// https://github.com/LuanRT/BgUtils/blob/main/examples/node/innertube-challenge-fetcher-example.ts

// use for fetch overriding
youtubei.Utils.Platform.shim.fetch = undici.fetch;
youtubei.Utils.Platform.shim.Request = undici.Request;
youtubei.Utils.Platform.shim.Response = undici.Response;

// https://ytjs.dev/guide/getting-started.html#providing-a-custom-javascript-interpreter
youtubei.Utils.Platform.shim.eval = async (data, env) => {
	const properties = [];

	if (env.n) properties.push(`n: exportedVars.nFunction("${env.n}")`);
	if (env.sig) properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);

	const code = `${data.output}\nreturn { ${properties.join(", ")} }`;

	const func = new Function(code);
	const result = func();

	return result;
};

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
			await this.createInnertube();
			await this.createIntegrityTokenBasedMinter();
		} catch (error) {
			console.log("Check acess to youtube.com (may be you need VPN or proxy)");
			console.log("Innertube error:", error.message);

			return this.application.exit(1);
		}
	}

	async createInnertube() {
		this.proxyAgent = this.createUndiciProxyAgent();

		// console.log("External ip:", (await (await undici.fetch("https://echo.free.beeceptor.com/", { dispatcher: this.proxyAgent })).json()).ip);

		this.innertube = await youtubei.Innertube.create({
			"retrieve_player": true,
			"location": undefined,
			"enable_safety_mode": false,
			"client_type": undefined,

			fetch: this.fetch.bind(this),
			"user_agent": userAgent,

			"enable_session_cache": true,
			"cache": new youtubei.UniversalCache(false, path.resolve(this.application.userDataDirectory, "innertubeCache"))
			// "generate_session_locally": true
		});

		// this.innertube.session.on("auth-pending", (data) => {
		// 	console.log(`Go to ${data.verification_url} in your browser and enter code ${data.user_code} to authenticate.`);
		// });

		// this.innertube.session.on("auth", async ({ credentials }) => {
		// 	console.log("[InnertubeYouTubeVideoInfoProvider] sign in successful");
		// 	await this.innertube.session.oauth.cacheCredentials();
		// });

		// this.innertube.session.on("update-credentials", async ({ credentials }) => {
		// 	console.log("[InnertubeYouTubeVideoInfoProvider] credentials updated");

		// 	await this.innertube.session.oauth.cacheCredentials();
		// });

		// await this.innertube.session.signIn();
	}

	createUndiciProxyAgent() {
		let proxyAgent = null;

		if (!this.application.config.proxy) return proxyAgent;

		let proxyUrl;
		try {
			proxyUrl = new URL(this.application.config.proxy);
		} catch (error) {
			throw new Error(`Bad proxy ${this.application.config.proxy}`);
		}

		switch (proxyUrl.protocol) {
			case "http:":
			case "https:": {
				const settings = {
					uri: proxyUrl.href
				};

				if (proxyUrl.username &&
					proxyUrl.password) {
					settings.token = `Basic ${Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString("base64")}`;
				}

				proxyAgent = new undici.ProxyAgent(settings);

				break;
			}

			case "socks5:": {
				const settings = {
					type: 5,
					host: proxyUrl.hostname,
					port: Number(proxyUrl.port)
				};

				if (proxyUrl.username &&
					proxyUrl.password) {
					settings.userId = proxyUrl.username;
					settings.password = proxyUrl.password;
				}

				proxyAgent = socksDispatcher(settings);

				break;
			}

			default: throw new Error(`Unknown proxy protocol ${proxyUrl.protocol}`);
		}

		return proxyAgent;
	}

	async fetch(input, init) {
		// if (this.application.isDevelopment) console.log(input.method ? input.method : "GET", input.url ? input.url.toString() : input.toString());

		if (this.proxyAgent) {
			init = {
				dispatcher: this.proxyAgent,
				...init
			};
		}

		try {
			const response = await undici.fetch(input, init);

			// if (this.application.isDevelopment) console.log(response.status, response.statusText);

			return response;
		} catch (error) {
			console.error("[InnertubeYouTubeVideoInfoProvider] fetch error:", error.message);

			throw error;
		}
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
			virtualConsole,
			resources: new jsdom.ResourceLoader({
				userAgent
			})
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
		const bgScriptResponse = await this.fetch(`https:${interpreterUrl}`);
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
		const requestKey = "O43z0dpjhgX20SCx4KAo"; // new Array(20).fill(0).map(() => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");

		const integrityTokenResponse = await this.fetch(bgutils.buildURL("GenerateIT", true), {
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

	async generatePoTokens(id) {
		const contentPoToken = await this.integrityTokenBasedMinter.mintAsWebsafeString(id);
		const sessionPoToken = await this.integrityTokenBasedMinter.mintAsWebsafeString(this.innertube.session.context.client.visitorData || "");

		return { contentPoToken, sessionPoToken };
	}

	setPoTokens(poTokens) {
		this.poTokens = poTokens;
		this.innertube.session["po_token"] = this.poTokens.contentPoToken;
		this.innertube.session.player["po_token"] = this.poTokens.sessionPoToken;
	}

	parseId(str) {
		const id = {
			parsed: false,
			type: "video",
			id: str
		};

		function success(type, strId) {
			id.parsed = true;
			id.type = type;
			id.id = strId;

			return id;
		}

		try {
			const url = new URL(str);

			let variant;

			if (url.host.toLowerCase().endsWith("youtube.com")) {
				variant = url.searchParams.get("v");
				if (this.testVideoId(variant)) return success("video", variant);

				variant = url.searchParams.get("list");
				if (this.testPlaylistId(variant)) return success("playlist", variant);
			} else if (url.host.toLowerCase().endsWith("youtu.be")) {
				variant = url.pathname.split("/")[1];
				if (this.testVideoId(variant)) return success("video", variant);
			}
		} catch (_) {
		}

		if (this.testVideoId(str)) return success("video", str);
		if (this.testPlaylistId(str)) return success("playlist", str);

		return id;
	}

	// A YouTube video ID is a unique 11-character string consisting of uppercase letters, lowercase letters, numbers, hyphens, and underscores. 
	// This ID is a core part of a video's URL and is used to identify the video, commonly found after v= or vi= in the URL or after youtu.be/. 
	testVideoId(str) {
		return /^[A-Za-z0-9_-]{11}$/.test(str);
	}

	// A standard YouTube playlist ID is a 32-character string, typically starting with "PL", that follows the pattern PL[A-Za-z0-9_-]{32}.
	//  This ID is the unique identifier for a public or private playlist and can be found in the URL of a playlist, after the list= parameter.
	testPlaylistId(str) {
		return /^PL[A-Za-z0-9_-]{32}$/.test(str);
	}

	async getVideoInfo(videoId) {
		this.setPoTokens(await this.generatePoTokens(videoId));

		const info = await this.innertube.getInfo(videoId);
		const mwebInfo = await this.innertube.getBasicInfo(videoId, "MWEB");

		// fs.outputFileSync(path.resolve(this.application.userDataDirectory, "info.json"), JSON.stringify({ info, mwebInfo }, null, "\t"));

		if (mwebInfo["playability_status"].status !== "OK" ||
			!mwebInfo["streaming_data"]) throw new Error("Bad playability status", { cause: mwebInfo["playability_status"].status });

		info["playability_status"] = mwebInfo["playability_status"];
		info["streaming_data"] = mwebInfo["streaming_data"];

		const { id, author, title } = info["basic_info"];

		const videoInfo = {
			meta: {
				poTokens: this.poTokens,

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

		return videoInfo;
	}

	async getPlaylistInfo(playlistId) {
		this.setPoTokens(await this.generatePoTokens(playlistId));

		const info = await this.innertube.getPlaylist(playlistId);

		const playlistInfo = {
			meta: {
				poTokens: this.poTokens,

				info
			},

			id: playlistId,
			author: info.info.author.name,
			channel: info.info.author.url,
			title: info.info.title,

			videos: info.items.map(item => ({
				id: item.id,
				title: item.title.text
			}))
		};

		return playlistInfo;
	}

	async getMediaStreamInfo(videoInfo, options) {
		const format = videoInfo.meta.info.chooseFormat(options);
		format.type = format["mime_type"];
		format.size = format["content_length"];
		format.duration = dayjs.duration(format["approx_duration_ms"]);

		return format;
	}

	async getMediaStream(videoInfo, options) {
		this.setPoTokens(videoInfo.meta.poTokens);

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
