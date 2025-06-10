import path from "node:path";
import stream from "node:stream";
import streamPromises from "node:stream/promises";
import streamСonsumers from "node:stream/consumers";

import { Command } from "commander";
import { config as dotenv } from "dotenv-flow";
import filenamify from "filenamify";
import fs from "fs-extra";

import { ffmpegGetExtractAACAudioFromMP4VideoStream } from "./utils/ffmpeg.js";
import Application from "./components/app/Application.js";
import dayjs from "./utils/dayjs.js";
import YouTubeVideoInfoDownloader from "./components/downloaders/YouTubeVideoInfoDownloader.js";
import YouTubeVideoInfoProvider from "./components/downloaders/InnertubeYouTubeVideoInfoProvider.js";
import progressPassThroughStream from "./utils/progressPassThroughStream.js";

dotenv();

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
		const youTubeVideoInfo = await this.youTubeVideoInfoProvider.getVideoInfo(youTubeId);

		// fs.outputFileSync(path.resolve(this.userDataDirectory, "youTubeVideoInfo.json"), JSON.stringify(youTubeVideoInfo, null, "\t"));
		// const youTubeVideoInfo = JSON.parse(fs.readFileSync(path.resolve(this.userDataDirectory, "youTubeVideoInfo.json")).toString());

		const formats = youTubeVideoInfo.formats.slice(0, 1);
		// .filter(format => format.audioQuality === "AUDIO_QUALITY_MEDIUM" &&
		// 	format.codec.includes("audio/webm"))
		// .sort((a, b) => b.size - a.size); // descending

		if (formats.length === 0) throw new Error("No concrete format");

		const mediaDownloadingStream = await this.youTubeVideoInfoDownloader.getMediaStream(youTubeVideoInfo, formats[0]);

		progressPassThroughStream({})

		// const mediaBuffer = await streamСonsumers.buffer(mediaDownloadingStream);

		// await streamPromises.finished(mediaDownloadingStream.pipe(fs.createWriteStream(path.resolve(this.userDataDirectory, "video.mp4"))));
		const mediaBuffer = fs.readFileSync(path.resolve(this.userDataDirectory, "video.mp4"));

		const outputDirectory = path.resolve(process.env.OUTPUT_DIRECTORY, filenamify(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}`, { replacement: "_", maxLength: 1024 }));
		fs.ensureDirSync(outputDirectory);

		const parts = [];

		if (youTubeVideoInfo.timings.length === 0 ||
			youTubeVideoInfo.timings[0].timing.asSeconds() !== 0) timings.push({ timing: dayjs.duration({ seconds: 0 }), caption: `${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}` });

		for (let i = 0; i < youTubeVideoInfo.timings.length; i++) {
			const timing = youTubeVideoInfo.timings[i];
			const nextTiming = i !== youTubeVideoInfo.timings.length - 1 ? youTubeVideoInfo.timings[i + 1] : null;
			parts.push({ start: timing.timing, finish: nextTiming?.timing, caption: timing.caption });
		}

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];

			const audioStream = ffmpegGetExtractAACAudioFromMP4VideoStream(stream.Readable.from(mediaBuffer), { start: part.start, finish: part.finish });
			const outputFileStream = fs.createWriteStream(path.resolve(outputDirectory, `${i.toString().padStart(3, "0")} - ${filenamify(part.caption, { replacement: "_" })}.aac`));

			await streamPromises.finished(audioStream.pipe(outputFileStream));
		}
	}
}

const application = new App();
await application.initialize();
await application.run();
