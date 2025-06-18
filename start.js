import childProcess from "node:child_process";
import path from "node:path";
import stream from "node:stream";
import streamPromises from "node:stream/promises";
import streamСonsumers from "node:stream/consumers";

import _ from "lodash";
import { Command } from "commander";
import { config as dotenv } from "dotenv-flow";
import ansiEscapes from "ansi-escapes";
import filenamify from "filenamify";
import fs from "fs-extra";
import ftp from "basic-ftp";
import YAML from "yaml";

import * as ffmpeg from "./utils/ffmpeg.js";
import Application from "./components/app/Application.js";
import dayjs from "./utils/dayjs.js";
import hash from "./utils/hash.js";
import ProgressBar from "./utils/ProgressBar.js";
import progressPassThroughStream from "./utils/progressPassThroughStream.js";
import YouTubeVideoInfoDownloader from "./components/downloaders/YouTubeVideoInfoDownloader.js";
import YouTubeVideoInfoProvider from "./components/downloaders/InnertubeYouTubeVideoInfoProvider.js";

dotenv({
	path: import.meta.dirname
});

const isDevelopment = process.env.VSCODE_INJECTION &&
	process.env.VSCODE_INSPECTOR_OPTIONS;

async function cacheData({ dataInfo, cacheDirectory, isUseCache, asyncDataGetter }) {
	let data;
	let dataFileCachePath;

	if (isUseCache) {
		dataFileCachePath = path.resolve(cacheDirectory, `${hash(dataInfo)}.cache.data`);
		if (fs.existsSync(dataFileCachePath)) data = fs.readFileSync(path.resolve(dataFileCachePath));
	}

	if (!data) {
		data = await asyncDataGetter(dataInfo);

		if (isUseCache) fs.outputFileSync(dataFileCachePath, data);
	}

	return data;
}

class Uploader {
	async initialize() { }
	async destroy() { }

	async createBaseDirectory(localDirectoryPath) { }
	async uploadFileStream(fileName, readableStream) { }
	async openBaseDirectoryInExplorer() { }
}

class FileSystemUploader extends Uploader {
	constructor(baseDirectory) {
		super();

		this.baseDirectory = baseDirectory;
	}

	async createBaseDirectory(localDirectoryPath) {
		this.baseDirectory = path.resolve(this.baseDirectory, localDirectoryPath);
		fs.ensureDirSync(this.baseDirectory);
	}

	async uploadFileStream(fileName, readableStream, onUploadUpdate) {
		const outputFileStream = fs.createWriteStream(path.resolve(this.baseDirectory, fileName));

		await streamPromises.finished(readableStream.pipe(outputFileStream));
	}

	async openBaseDirectoryInExplorer() {
		childProcess.spawn("explorer.exe", [this.baseDirectory]);
	}
}

class FtpUploader extends Uploader {
	constructor(baseUrl) {
		super();

		this.baseUrl = baseUrl;
	}

	async initialize() {
		this.client = new ftp.Client();

		// client.ftp.verbose = true;

		await this.client.access({
			host: this.baseUrl.hostname,
			port: Number(this.baseUrl.port)
		});
	}

	async destroy() {
		this.client.close();

		this.client = null;
	}

	async createBaseDirectory(localDirectoryPath) {
		this.baseDirectory = this.baseUrl.pathname + "/" + localDirectoryPath;

		await this.client.ensureDir(this.baseDirectory);
		await this.client.cd("/");
	}

	async uploadFileStream(fileName, readableStream, onUploadUpdate) {
		this.client.trackProgress(null);

		try {
			if (onUploadUpdate) {
				this.client.trackProgress(info => {
					onUploadUpdate(info.bytes);
				});
			}

			await this.client.uploadFrom(readableStream, this.baseDirectory + "/" + fileName);
		} finally {
			this.client.trackProgress(null);
		}
	}

	async openBaseDirectoryInExplorer() {
		childProcess.spawn("explorer.exe", [this.baseUrl.origin + this.baseDirectory]);
	}
}

const BASE_CONFIG = {
	outputDirectory: ""
};

class App extends Application {
	constructor() {
		super();

		this.printLogo();

		this.addComponent(this.youTubeVideoInfoProvider = new YouTubeVideoInfoProvider());
		this.addComponent(this.youTubeVideoInfoDownloader = new YouTubeVideoInfoDownloader());
	}

	printLogo() {
		const logo = `
          __      __               __    __
   __  __/ /_____/ /      ______  / /___/ /
  / / / / __/ __  / | /| / / __ \\/ / __  / 
 / /_/ / /_/ /_/ /| |/ |/ / / / / / /_/ /  
 \\__, /\\__/\\__,_/ |__/|__/_/ /_/_/\\__,_/   
/____/                     ############
`.replace("############", `v ${this.info.version}`.padStart(12, " "));

		console.log(logo);
	}

	get isDevelopment() {
		return isDevelopment;
	}

	async initialize() {
		this.createUserDataDirectory();
		this.createConfig();

		await this.checkFfmpeg();

		await super.initialize();
	}

	createUserDataDirectory() {
		this.userDataDirectory = this.isDevelopment
			? path.resolve(import.meta.dirname, "userData")
			: path.resolve(process.env.APPDATA, filenamify(this.info.name));

		fs.ensureDirSync(this.userDataDirectory);
	}

	createConfig() {
		this.configPath = path.resolve(this.userDataDirectory, "config.yaml");

		let userConfig;
		if (fs.existsSync(this.configPath)) {
			try {
				userConfig = YAML.parse(fs.readFileSync(this.configPath).toString());
			} catch (error) {
				console.error(`Error in reading config file: ${this.configPath}, please, edit or remove it`);

				return process.exit();
			}
		}

		this.config = _.merge({}, BASE_CONFIG, userConfig);

		if (!userConfig) fs.outputFileSync(this.configPath, YAML.stringify(this.config));
	}

	async checkFfmpeg() {
		try {
			await ffmpeg.getVersion();
		} catch (error) {
			console.log("ffmpeg error:", error.message);

			return process.exit();
		}
	}

	async run() {
		await super.run();

		if (isDevelopment) console.warn("[isDevelopment]");
		console.log(`[userDataDirectory]: ${this.userDataDirectory}`);
		console.log(`[config]: ${this.configPath}`);
		console.log(`[config.outputDirectory]: ${this.config.outputDirectory}`);
	}

	async processYouTubeIds(args) {
		const youTubeIds = Array.from(new Set(args.map(arg => arg.split(",")).flat().map(s => s.trim()).filter(Boolean)))
			.map(videoUrlOrId => this.youTubeVideoInfoProvider.parseVideoId(videoUrlOrId));

		console.log(`Total ${youTubeIds.length} videos: ${youTubeIds.join(", ")}`);

		await this.createUploader();

		for (let i = 0; i < youTubeIds.length; i++) {
			const youTubeId = youTubeIds[i];

			console.log(`Start processing ${i + 1}/${youTubeIds.length} ${youTubeId}`);
			await this.processYouTubeId(youTubeId);
			console.log(`Finish processing ${youTubeId}`);
		}

		await this.uploader.destroy();
	}

	async processYouTubeId(youTubeId) {
		const youTubeVideoInfo = await this.youTubeVideoInfoProvider.getVideoInfo(youTubeId);
		console.log(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}`);

		// fs.outputFileSync(path.resolve(this.userDataDirectory, "youTubeVideoInfo.json"), JSON.stringify(youTubeVideoInfo, null, "\t"));
		// const youTubeVideoInfo = JSON.parse(fs.readFileSync(path.resolve(this.userDataDirectory, "youTubeVideoInfo.json")).toString());

		// select first 360p mp4 video
		const formatOptions = {};

		// select opus ogg audio
		// const formatOptions = {
		// 	type: "audio",
		// 	codec: "opus",
		// 	format: "audio/webm",
		// 	quality: "best"
		// };

		const mediaStreamInfo = await this.youTubeVideoInfoProvider.getMediaStreamInfo(youTubeVideoInfo, formatOptions);
		const mediaDownloadingStream = await this.youTubeVideoInfoProvider.getMediaStream(youTubeVideoInfo, formatOptions);

		const mediaBuffer = await cacheData({
			dataInfo: youTubeId,
			cacheDirectory: path.resolve(this.userDataDirectory, "videoCache"),
			isUseCache: isDevelopment,
			asyncDataGetter: async youTubeId => {
				const mediaDownloadingProgressStream = progressPassThroughStream({
					dataLength: mediaStreamInfo.size,
					onStart: () => { console.log(`Downloading ${mediaStreamInfo.type}`); },
					onFinish: () => { process.stdout.write(ansiEscapes.eraseLines(3)); }
				});

				const mediaStream = mediaDownloadingStream.pipe(mediaDownloadingProgressStream);

				return streamСonsumers.buffer(mediaStream);
			}
		});

		await this.uploader.createBaseDirectory(filenamify(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}`, { replacement: "", maxLength: 128 }));

		const parts = [];

		if (youTubeVideoInfo.timings.length === 0) parts.push({ caption: youTubeVideoInfo.title });
		else if (youTubeVideoInfo.timings[0].timing.asSeconds() !== 0) parts.push({ start: dayjs.duration({ seconds: 0 }), finish: youTubeVideoInfo.timings[0].timing, caption: youTubeVideoInfo.title });

		for (let i = 0; i < youTubeVideoInfo.timings.length; i++) {
			const timing = youTubeVideoInfo.timings[i];
			const nextTiming = i !== youTubeVideoInfo.timings.length - 1 ? youTubeVideoInfo.timings[i + 1] : null;
			parts.push({ start: timing.timing, finish: nextTiming?.timing, caption: timing.caption });
		}

		console.log("Chapters:");
		for (let i = 0; i < parts.length; i++) 	console.log(`${(i + 1).toString().padStart(3, "0")} - ${parts[i].caption}`);

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];

			const fileName = `${(i + 1).toString().padStart(3, "0")} - ${filenamify(part.caption, { replacement: "_" })}.aac`;

			const mediaStream = stream.Readable.from(mediaBuffer)
				.pipe(
					progressPassThroughStream({
						dataLength: mediaBuffer.byteLength,
						onStart: () => { console.log(`Extracting audio ${(i + 1).toString().padStart(3, "0")}/${parts.length.toString().padStart(3, "0")} ${fileName}`); },
						onFinish: () => { process.stdout.write(ansiEscapes.eraseLines(3)); }
					})
				);

			const audioStream = ffmpeg.getExtractAACAudioFromMP4VideoStream(mediaStream, { start: part.start, finish: part.finish });
			const audioBuffer = await streamСonsumers.buffer(audioStream);

			const uploadStream = stream.Readable.from(audioBuffer);

			const uploadProgressBar = new ProgressBar(audioBuffer.byteLength);

			console.log(`Uploading file ${(i + 1).toString().padStart(3, "0")}/${parts.length.toString().padStart(3, "0")} ${fileName}`);
			uploadProgressBar.start();

			await this.uploader.uploadFileStream(fileName, uploadStream, uploadedLength => { uploadProgressBar.update(uploadedLength); });

			uploadProgressBar.finish();
			process.stdout.write(ansiEscapes.eraseLines(3));
		}

		if (!isDevelopment) await this.uploader.openBaseDirectoryInExplorer();
	}

	async createUploader() {
		this.uploader = null;

		if (!this.config.outputDirectory) throw new Error("None outputDirectory, set it in config");

		try {
			const outputDirectoryUrl = new URL(this.config.outputDirectory);
			if (outputDirectoryUrl.protocol.toLowerCase() === "ftp:") this.uploader = new FtpUploader(outputDirectoryUrl);
		} catch (_) {
		}

		if (!this.uploader) this.uploader = new FileSystemUploader(this.config.outputDirectory);

		console.log(`Using ${this.uploader.constructor.name} uploader`);
		console.log(`${this.uploader.constructor.name} uploader initializing`);
		await this.uploader.initialize();
		console.log(`${this.uploader.constructor.name} uploader initialized`);
		process.stdout.write(ansiEscapes.eraseLines(3));
	}
}

const application = new App();

const program = new Command();
program
	.name(application.info.name)
	.version(application.info.version)
	.description("Application to download youtube videos as audio and upload/save to FTP/Telegram/Filesystem")
	.argument("<videoIds...>", "youtube video urls or IDs comma separated")
	// .option("-a, --audio", "Download AAC audio", true)
	// .option("-s, --subs", "Download subtitles", false)
	// .option("-c, --chapters", "Split to chapters")
	// .option("-t --telegram", "Upload to telegram bot")
	.action(async (name, options, command) => {
		await application.initialize();
		await application.run();

		if (command.args.length > 0 &&
			command.args[0] === "config") {
			const process = childProcess.spawn("explorer.exe", [application.configPath]);

			await new Promise(resolve => process.once("exit", resolve));
		} else {
			await application.processYouTubeIds(command.args);
		}

		return process.exit();
	})
	.command("help")
	.action(() => {
		program.help();
	});

program.showHelpAfterError();

program
	.parse(
		isDevelopment
			? [...process.argv.slice(0, 2), ...(process.env.DEVELOPMENT_ARGS || "").split(" ").map(s => s.trim()).filter(Boolean)]
			: undefined
	);
