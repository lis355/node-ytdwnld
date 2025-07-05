import childProcess from "node:child_process";
import path from "node:path";
import stream from "node:stream";
import streamСonsumers from "node:stream/consumers";
import streamPromises from "node:stream/promises";

import _ from "lodash";
import { config as dotenv } from "dotenv-flow";
import ansiEscapes from "ansi-escapes";
import * as commander from "commander";
import filenamify from "filenamify";
import fs from "fs-extra";
import srtParser2 from "srt-parser-2";
import YAML from "yaml";

import Application from "./components/app/Application.js";
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
		this.createTemporaryDirectory();
		this.createConfig();

		await super.initialize();
	}

	createUserDataDirectory() {
		this.userDataDirectory = this.isDevelopment
			? path.resolve(import.meta.dirname, "userData")
			: path.resolve(process.env.APPDATA, filenamify(this.info.name));

		fs.ensureDirSync(this.userDataDirectory);
	}

	createTemporaryDirectory() {
		this.tempDirectory = path.resolve(this.userDataDirectory, "temp");

		fs.ensureDirSync(this.tempDirectory);
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

		try {
			for (let i = 0; i < youTubeIds.length; i++) {
				const youTubeId = youTubeIds[i];

				console.log(`Start processing ${i + 1}/${youTubeIds.length} ${youTubeId}`);
				await this.processYouTubeId(youTubeId);
				console.log(`Finish processing ${youTubeId}`);
			}
		} catch (error) {
			throw error;
		} finally {
			if (this.uploadManager.uploader) await this.uploadManager.destroyUploader();
		}
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
		const mediaDuration = dayjs.duration(mediaStreamInfo["approx_duration_ms"]);
		console.log(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title} (${mediaDuration.format("HH:mm:ss")})`);

		const chapters = this.extractChapters(youTubeVideoInfo, mediaDuration);
		for (let i = 0; i < chapters.length; i++) console.log(`${(i + 1).toString().padStart(3, "0")} - ${chapters[i].caption}`);

		const downloadMedia = async mediaFileName => {
			const mediaDownloadingStream = await this.youTubeVideoInfoProvider.getMediaStream(youTubeVideoInfo, formatOptions);

			const mediaDownloadingProgressStream = progressPassThroughStream({
				dataLength: mediaStreamInfo.size,
				onStart: () => { console.log(`Downloading ${mediaStreamInfo.type}`); },
				onFinish: () => { process.stdout.write(ansiEscapes.eraseLines(3)); }
			});

			await streamPromises.finished(
				mediaDownloadingStream
					.pipe(mediaDownloadingProgressStream)
					.pipe(fs.createWriteStream(mediaFileName))
			);
		};

		let tempMediaFileName = path.resolve(this.tempDirectory, "0.mp4");
		if (isDevelopment) { // caching
			const videoCacheDirectory = path.resolve(this.userDataDirectory, "videoCache");
			fs.ensureDirSync(videoCacheDirectory);

			tempMediaFileName = path.resolve(videoCacheDirectory, `${youTubeId}.mp4`);

			if (!fs.existsSync(tempMediaFileName)) await downloadMedia(tempMediaFileName);
		} else {
			await downloadMedia(tempMediaFileName);
		}

		const mediaDirectoryName = filenamify(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}`, { replacement: "", maxLength: 128 });

		await this.uploadManager.createBaseDirectory(mediaDirectoryName);

		const metadataFilePath = path.resolve(this.tempDirectory, "metadata.txt");
		await this.createMetadata(metadataFilePath, youTubeVideoInfo, chapters);

		const outputAudioFileNameWithoutExtension = "0";
		const outputAudioFileName = outputAudioFileNameWithoutExtension + ".m4b";
		const tempOutputAudioFilePath = path.resolve(this.tempDirectory, outputAudioFileName);

		await this.ffmpegManager.extractAACAudioFromMP4VideoStream(tempMediaFileName, metadataFilePath, tempOutputAudioFilePath);

		const uploadStream = fs.createReadStream(tempOutputAudioFilePath);
		const tempOutputAudioFileSize = fs.statSync(tempOutputAudioFilePath).size;

		const uploadProgressBar = new ProgressBar(tempOutputAudioFileSize);

		console.log("Uploading audio file");
		uploadProgressBar.start();

		await this.uploadManager.uploadFileStream(outputAudioFileName, uploadStream, uploadedLength => { uploadProgressBar.update(uploadedLength); });

		uploadProgressBar.finish();
		process.stdout.write(ansiEscapes.eraseLines(3));

		if (youTubeVideoInfo.subtitles) {
			console.log("Downloading subtitles");

			const subtitlesStream = await this.youTubeVideoInfoProvider.getSubtitlesStream(youTubeVideoInfo);
			const subtitlesBuffer = await streamСonsumers.buffer(subtitlesStream);

			const srtParser = new srtParser2();
			const subtitles = srtParser.fromSrt(subtitlesBuffer.toString());
			// this.fixSubtitles(subtitles);

			await this.uploadManager.uploadFileStream(outputAudioFileNameWithoutExtension + ".srt", stream.Readable.from(srtParser.toSrt(subtitles)));
			await this.uploadManager.uploadFileStream(`${mediaDirectoryName}.txt`, stream.Readable.from(this.getSubtitlesFormattedText(subtitles, chapters)));

			console.log("Done");
		}

		await this.uploadManager.uploadFileStream("info.json", stream.Readable.from(JSON.stringify({
			id: youTubeVideoInfo.id,
			link: "https://www.youtube.com/watch?v=" + youTubeVideoInfo.id,
			channel: _.get(youTubeVideoInfo, "meta.info.basic_info.channel.name"),
			channelLink: _.get(youTubeVideoInfo, "meta.info.basic_info.channel.url"),
			author: youTubeVideoInfo.author,
			title: youTubeVideoInfo.title,
			duration: mediaDuration.format("HH:mm:ss"),
			chapters: chapters.map(chapter => `${chapter.start.format("HH:mm:ss")} - ${chapter.caption}`)
		}, null, "\t")));

		if (!isDevelopment) await this.uploadManager.openBaseDirectoryInExplorer();
	}

	extractChapters(youTubeVideoInfo, mediaDuration) {
		const chapters = [];

		if (youTubeVideoInfo.timings.length === 0) chapters.push({ caption: youTubeVideoInfo.title });
		else if (youTubeVideoInfo.timings[0].timing.asSeconds() !== 0) chapters.push({ start: dayjs.duration({ seconds: 0 }), finish: youTubeVideoInfo.timings[0].timing, caption: youTubeVideoInfo.title });

		for (let i = 0; i < youTubeVideoInfo.timings.length; i++) {
			const timing = youTubeVideoInfo.timings[i];
			const nextTiming = i !== youTubeVideoInfo.timings.length - 1 ? youTubeVideoInfo.timings[i + 1] : null;
			chapters.push({ start: timing.timing, finish: nextTiming?.timing || mediaDuration, caption: timing.caption });
		}

		return chapters;
	}

	async createMetadata(metadataFilePath, youTubeVideoInfo, chapters) {
		const metadataStream = fs.createWriteStream(metadataFilePath);

		metadataStream.write(`;FFMETADATA1
title=${youTubeVideoInfo.title}
artist=${youTubeVideoInfo.author}

`);

		for (const chapter of chapters) {
			metadataStream.write(`[CHAPTER]
TIMEBASE=1/1000
START=${chapter.start.asMilliseconds()}
END=${chapter.finish.asMilliseconds()}
title=${chapter.caption}

`);
		}

		metadataStream.end();

		await streamPromises.finished(metadataStream);
	}

	// fixSubtitles(subtitles) {
	// 	// на ютубе субтитры могут накладываться друг на друга что не всегда корректно работает в разных плеерах
	// 	// сделаем, чтобы все элементы массива субтитров были последовательными
	// 	for (let i = 1; i < subtitles.length; i++) {
	// 		const previousItem = subtitles[i - 1];
	// 		const currentItem = subtitles[i];

	// 		if (previousItem.endSeconds > currentItem.startSeconds) {
	// 			previousItem.endSeconds = currentItem.endSeconds;
	// 			previousItem.endSeconds = currentItem.endSeconds;
	// 			previousItem.text += " " + currentItem.text;

	// 			subtitles.splice(i, 1);
	// 			i--;
	// 		}
	// 	}

	// 	for (let i = 0; i < subtitles.length; i++) subtitles[i].id = (i + 1).toString();
	// }

	getSubtitlesFormattedText(subtitles, chapters) {
		// TODO сделать нормально https://github.com/lis355/node-ytdwnld/issues/9

		const parts = [];

		let nextChapterIndex = 0;

		for (const subtitle of subtitles) {
			if (nextChapterIndex < chapters.length) {
				const nextChapter = chapters[nextChapterIndex];
				if (dayjs.duration({ seconds: subtitle.endSeconds }) > nextChapter.start) {
					// TODO не разрывать предложения
					parts.push(`\n\n${dayjs.duration(nextChapter.start.asMilliseconds()).format("HH:mm:ss")} ${nextChapter.caption}\n\n`);

					nextChapterIndex++;
				}
			}

			parts.push(subtitle.text + " ");
		}

		return parts.join("").trim();
	}
}

const application = new App();

const program = new commander.Command();
program
	.name(application.info.name)
	.version(application.info.version)
	.description("Application to download youtube videos as audio and upload/save to Filesystem/FTP");

program.showHelpAfterError();

program
	.command("config")
	.description("Open config file")
	.action(async () => {
		await runApplicationWithAction(async () => {
			const process = childProcess.spawn("explorer.exe", [application.configPath]);

			await new Promise(resolve => process.once("exit", resolve));
		});
	});

program
	.command("download", { isDefault: true })
	.description("Download videos")
	.argument("<videoIds...>", "youtube video urls or IDs comma separated")
	// .option("-a, --audio", "Download AAC audio", true)
	// .option("-s, --subs", "Download subtitles", false)
	// .option("-c, --chapters", "Split to chapters")
	// .option("-t --telegram", "Upload to telegram bot")
	.action(async (name, options, command) => {
		await runApplicationWithAction(async () => {
			await application.processYouTubeIds(command.args);
		});
	});

program
	.parse(
		isDevelopment
			? [...process.argv.slice(0, 2), ...(process.env.DEVELOPMENT_ARGS || "").split(" ").map(s => s.trim()).filter(Boolean)]
			: undefined
	);

async function runApplicationWithAction(asyncAction) {
	await application.initialize();
	await application.run();

	try {
		await asyncAction();
	} catch (error) {
		throw error;
	} finally {
		fs.removeSync(application.tempDirectory, "temp");
	}

	return process.exit();
}
