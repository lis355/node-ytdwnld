import childProcess from "node:child_process";
import path from "node:path";
import stream from "node:stream";
import streamСonsumers from "node:stream/consumers";
// import streamPromises from "node:stream/promises";

import _ from "lodash";
import { Command } from "commander";
import { config as dotenv } from "dotenv-flow";
import ansiEscapes from "ansi-escapes";
import filenamify from "filenamify";
import fs from "fs-extra";
import srtParser2 from "srt-parser-2";
import YAML from "yaml";

import Application from "./components/app/Application.js";
import cacheData from "./utils/cacheData.js";
import dayjs from "./utils/dayjs.js";
import FFMpegManager from "./components/FFMpegManager.js";
import ProgressBar from "./utils/ProgressBar.js";
import progressPassThroughStream from "./utils/progressPassThroughStream.js";
import UploadManager from "./components/uploaders/UploadManager.js";
import YouTubeVideoInfoProvider from "./components/downloaders/InnertubeYouTubeVideoInfoProvider.js";

dotenv({
	path: import.meta.dirname
});

const isDevelopment = process.env.VSCODE_INJECTION &&
	process.env.VSCODE_INSPECTOR_OPTIONS;

const BASE_CONFIG = {
	outputDirectory: ""
};

class App extends Application {
	constructor() {
		super();

		this.printLogo();

		this.addComponent(this.ffmpegManager = new FFMpegManager());
		this.addComponent(this.youTubeVideoInfoProvider = new YouTubeVideoInfoProvider());
		this.addComponent(this.uploadManager = new UploadManager());
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

		await this.uploadManager.createUploader();

		for (let i = 0; i < youTubeIds.length; i++) {
			const youTubeId = youTubeIds[i];

			console.log(`Start processing ${i + 1}/${youTubeIds.length} ${youTubeId}`);
			await this.processYouTubeId(youTubeId);
			console.log(`Finish processing ${youTubeId}`);
		}

		await this.uploadManager.destroyUploader();
	}

	async processYouTubeId(youTubeId) {
		const youTubeVideoInfo = await this.youTubeVideoInfoProvider.getVideoInfo(youTubeId);

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
		console.log(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title} (${dayjs.duration(mediaStreamInfo["approx_duration_ms"]).format("HH:mm:ss")})`);

		const mediaDownloadingStream = await this.youTubeVideoInfoProvider.getMediaStream(youTubeVideoInfo, formatOptions);

		// download video
		// await streamPromises.finished(
		// 	mediaDownloadingStream.pipe(
		// 		fs.createWriteStream(path.resolve(this.config.outputDirectory, filenamify(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}.mp4`))
		// 		))
		// );

		const mediaBuffer = await cacheData({
			isUseCache: isDevelopment,
			cacheDirectory: path.resolve(this.userDataDirectory, "videoCache"),
			cacheFileName: `${youTubeId}.mp4`,
			dataInfo: youTubeId,
			asyncDataGetter: async dataInfo => {
				const mediaDownloadingProgressStream = progressPassThroughStream({
					dataLength: mediaStreamInfo.size,
					onStart: () => { console.log(`Downloading ${mediaStreamInfo.type}`); },
					onFinish: () => { process.stdout.write(ansiEscapes.eraseLines(3)); }
				});

				const mediaStream = mediaDownloadingStream.pipe(mediaDownloadingProgressStream);

				return streamСonsumers.buffer(mediaStream);
			}
		});

		const mediaDirectoryName = filenamify(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}`, { replacement: "", maxLength: 128 });
		await this.uploadManager.createBaseDirectory(mediaDirectoryName);

		const chapters = [];

		if (youTubeVideoInfo.timings.length === 0) chapters.push({ caption: youTubeVideoInfo.title });
		else if (youTubeVideoInfo.timings[0].timing.asSeconds() !== 0) chapters.push({ start: dayjs.duration({ seconds: 0 }), finish: youTubeVideoInfo.timings[0].timing, caption: youTubeVideoInfo.title });

		for (let i = 0; i < youTubeVideoInfo.timings.length; i++) {
			const timing = youTubeVideoInfo.timings[i];
			const nextTiming = i !== youTubeVideoInfo.timings.length - 1 ? youTubeVideoInfo.timings[i + 1] : null;
			chapters.push({ start: timing.timing, finish: nextTiming?.timing, caption: timing.caption });
		}

		console.log("Chapters:");
		for (let i = 0; i < chapters.length; i++) 	console.log(`${(i + 1).toString().padStart(3, "0")} - ${chapters[i].caption}`);

		for (let i = 0; i < chapters.length; i++) {
			const chapter = chapters[i];

			const mediaStream = stream.Readable.from(mediaBuffer)
				.pipe(
					progressPassThroughStream({
						dataLength: mediaBuffer.byteLength,
						onStart: () => { console.log(`Extracting audio ${(i + 1).toString().padStart(3, "0")}/${chapters.length.toString().padStart(3, "0")} ${chapter.caption}`); },
						onFinish: () => { process.stdout.write(ansiEscapes.eraseLines(3)); }
					})
				);

			const audioStream = this.ffmpegManager.getExtractAACAudioFromMP4VideoStream(mediaStream, { start: chapter.start, finish: chapter.finish });
			const audioBuffer = await streamСonsumers.buffer(audioStream);

			// fs.outputFileSync(path.resolve(this.userDataDirectory, "test.aac"), audioBuffer);

			const uploadStream = stream.Readable.from(audioBuffer);

			const uploadProgressBar = new ProgressBar(audioBuffer.byteLength);

			console.log(`Uploading file ${(i + 1).toString().padStart(3, "0")}/${chapters.length.toString().padStart(3, "0")} ${chapter.caption}`);
			uploadProgressBar.start();

			const fileName = `${(i + 1).toString().padStart(3, "0")} - ${filenamify(chapter.caption, { replacement: "_" })}.aac`;
			await this.uploadManager.uploadFileStream(fileName, uploadStream, uploadedLength => { uploadProgressBar.update(uploadedLength); });

			uploadProgressBar.finish();
			process.stdout.write(ansiEscapes.eraseLines(3));
		}

		await this.uploadManager.uploadFileStream("info.json", stream.Readable.from(JSON.stringify({
			id: youTubeVideoInfo.id,
			link: "https://www.youtube.com/watch?v=" + youTubeVideoInfo.id,
			channel: _.get(youTubeVideoInfo, "meta.info.basic_info.channel.name"),
			channelLink: _.get(youTubeVideoInfo, "meta.info.basic_info.channel.url"),
			author: youTubeVideoInfo.author,
			title: youTubeVideoInfo.title,
			duration: dayjs.duration(mediaStreamInfo["approx_duration_ms"]).format("HH:mm:ss")
		}, null, "\t")));

		if (youTubeVideoInfo.subtitles) {
			console.log("Downloading subtitles");

			const subtitlesStream = await this.youTubeVideoInfoProvider.getSubtitlesStream(youTubeVideoInfo);
			const subtitlesBuffer = await streamСonsumers.buffer(subtitlesStream);
			await this.uploadManager.uploadFileStream(`${mediaDirectoryName}.srt`, stream.Readable.from(subtitlesBuffer));

			const subtitles = new srtParser2().fromSrt(subtitlesBuffer.toString());
			await this.uploadManager.uploadFileStream(`${mediaDirectoryName}.txt`, stream.Readable.from(this.getSubtitlesFormattedText(subtitles, chapters)));

			console.log("Done");
		}

		if (!isDevelopment) await this.uploadManager.openBaseDirectoryInExplorer();
	}

	getSubtitlesFormattedText(subtitles, chapters) {
		// TODO сделать нормально https://github.com/lis355/node-ytdwnld/issues/9

		const parts = [];

		let nextChapterIndex = 0;

		for (const subtitle of subtitles) {
			if (nextChapterIndex < chapters.length) {
				const nextChapter = chapters[nextChapterIndex];
				if (dayjs.duration({ seconds: subtitle.endSeconds }) > nextChapter.start) {
					// TODO не разрывать предложения
					parts.push(`\n\n${dayjs.duration(nextChapter.start.asMilliseconds()).format("HH:mm:ss")} ${(nextChapterIndex + 1).toString().padStart(3, "0")}/${chapters.length.toString().padStart(3, "0")} ${nextChapter.caption}\n\n`);

					nextChapterIndex++;
				}
			}

			parts.push(subtitle.text + " ");
		}

		return parts.join("").trim();
	}
}

const application = new App();

const program = new Command();
program
	.name(application.info.name)
	.version(application.info.version)
	.description("Application to download youtube videos as audio and upload/save to Filesystem/FTP")
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
