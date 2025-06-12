import childProcess from "node:child_process";
import path from "node:path";
import stream from "node:stream";
import streamPromises from "node:stream/promises";
import streamСonsumers from "node:stream/consumers";

import { Command } from "commander";
import { config as dotenv } from "dotenv-flow";
import filenamify from "filenamify";
import fs from "fs-extra";
import ftp from "basic-ftp";

import { ffmpegGetExtractAACAudioFromMP4VideoStream } from "./utils/ffmpeg.js";
import Application from "./components/app/Application.js";
import dayjs from "./utils/dayjs.js";
import ProgressBar from "./utils/ProgressBar.js";
import progressPassThroughStream from "./utils/progressPassThroughStream.js";
import YouTubeVideoInfoDownloader from "./components/downloaders/YouTubeVideoInfoDownloader.js";
import YouTubeVideoInfoProvider from "./components/downloaders/InnertubeYouTubeVideoInfoProvider.js";

dotenv();

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

class App extends Application {
	constructor() {
		super();

		this.addComponent(this.youTubeVideoInfoProvider = new YouTubeVideoInfoProvider());
		this.addComponent(this.youTubeVideoInfoDownloader = new YouTubeVideoInfoDownloader());
	}

	async initialize() {
		const logo = `
          __      __               __    __
   __  __/ /_____/ /      ______  / /___/ /
  / / / / __/ __  / | /| / / __ \\/ / __  / 
 / /_/ / /_/ /_/ /| |/ |/ / / / / / /_/ /  
 \\__, /\\__/\\__,_/ |__/|__/_/ /_/_/\\__,_/   
/____/                     ############
`.replace("############", `v ${this.info.version}`.padStart(12, " "));

		console.log(logo);

		this.userDataDirectory = path.resolve(import.meta.dirname, "userData");
		fs.ensureDirSync(this.userDataDirectory);

		await super.initialize();
	}

	async run() {
		await super.run();

		console.log(`[Application directory]: ${import.meta.dirname}`);
		console.log("[Config]:");
		console.log(`[OUTPUT_DIRECTORY]: ${process.env.OUTPUT_DIRECTORY}`);

		const program = new Command();

		program
			.name(this.info.name)
			.version(this.info.version)
			.description("Application to download youtube videos as audio and upload/save to FTP/Telegram/Filesystem")
			.argument("<video>", "youtube video url or ID");
		// .option("-a, --audio", "Download AAC audio", true)
		// .option("-s, --subs", "Download subtitles", false)
		// .option("-c, --chapters", "Split to chapters")
		// .option("-t --telegram", "Upload to telegram bot")

		program.parse();

		const videoUrlOrId = program.args[0];

		const youTubeId = this.youTubeVideoInfoProvider.parseVideoId(videoUrlOrId);
		console.log(`[YouTubeVideoId]: ${youTubeId}`);

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
		const mediaDownloadingProgressStream = progressPassThroughStream({
			dataLength: mediaStreamInfo.size,
			onStart: () => { console.log(`Downloading ${mediaStreamInfo.type}`); }
		});

		const mediaStream = mediaDownloadingStream.pipe(mediaDownloadingProgressStream);
		const mediaBuffer = await streamСonsumers.buffer(mediaStream);

		await streamPromises.finished(mediaStream.pipe(fs.createWriteStream(path.resolve(this.userDataDirectory, "video.mp4"))));
		// const mediaBuffer = fs.readFileSync(path.resolve(this.userDataDirectory, "video.mp4"));

		let uploader;
		try {
			const outputDirectoryUrl = new URL(process.env.OUTPUT_DIRECTORY);
			if (outputDirectoryUrl.protocol.toLowerCase() === "ftp:") uploader = new FtpUploader(outputDirectoryUrl);
		} catch (_) {
		}

		if (!uploader) uploader = new FileSystemUploader(process.env.OUTPUT_DIRECTORY);

		await uploader.initialize();

		await uploader.createBaseDirectory(filenamify(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}`, { replacement: "", maxLength: 128 }));

		const parts = [];

		if (youTubeVideoInfo.timings.length === 0 ||
			youTubeVideoInfo.timings[0].timing.asSeconds() !== 0) parts.push({ start: dayjs.duration({ seconds: 0 }), finish: youTubeVideoInfo.timings[0].timing, caption: `${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}` });

		for (let i = 0; i < youTubeVideoInfo.timings.length; i++) {
			const timing = youTubeVideoInfo.timings[i];
			const nextTiming = i !== youTubeVideoInfo.timings.length - 1 ? youTubeVideoInfo.timings[i + 1] : null;
			parts.push({ start: timing.timing, finish: nextTiming?.timing, caption: timing.caption });
		}

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];

			const mediaStream = stream.Readable.from(mediaBuffer)
				.pipe(
					progressPassThroughStream({
						dataLength: mediaBuffer.byteLength,
						onStart: () => { console.log(`Extracting audio ${i.toString().padStart(3, "0")}/${parts.length.toString().padStart(3, "0")} ${part.caption}`); }
					})
				);

			const audioStream = ffmpegGetExtractAACAudioFromMP4VideoStream(mediaStream, { start: part.start, finish: part.finish });
			const audioBuffer = await streamСonsumers.buffer(audioStream);

			const fileName = `${i.toString().padStart(3, "0")} - ${filenamify(part.caption, { replacement: "_" })}.aac`;

			const uploadStream = stream.Readable.from(audioBuffer);

			const uploadProgressBar = new ProgressBar(audioBuffer.byteLength);

			console.log(`Uploading file ${fileName}`);
			uploadProgressBar.start();

			await uploader.uploadFileStream(fileName, uploadStream, uploadedLength => { uploadProgressBar.update(uploadedLength); });

			uploadProgressBar.finish();
		}

		await uploader.openBaseDirectoryInExplorer();

		await uploader.destroy();
	};
}

const application = new App();
await application.initialize();
await application.run();
