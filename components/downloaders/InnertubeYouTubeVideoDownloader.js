import path from "node:path";
import stream from "node:stream";
import streamСonsumers from "node:stream/consumers";
import streamPromises from "node:stream/promises";

import _ from "lodash";
import ansiEscapes from "ansi-escapes";
import chalk from "chalk";
import fs from "fs-extra";

import ApplicationComponent from "../app/ApplicationComponent.js";
import dayjs from "../../utils/dayjs.js";
import filenamify from "../../utils/filenamify.js";
import ProgressBar from "../../utils/ProgressBar.js";
import progressPassThroughStream from "../../utils/progressPassThroughStream.js";
// import SRTParser from "../../utils/srt.js";

export default class InnertubeYouTubeVideoDownloader extends ApplicationComponent {
	async initialize() {
		await super.initialize();
	}

	async processYouTubeIds(args, options) {
		const infos = _.uniqBy(
			args.map(arg => arg.split(",")).flat().map(s => s.trim()).filter(Boolean)
				.map(str => this.application.youTubeVideoInfoProvider.parseId(str))
				.filter(info => info.parsed),
			info => info.id
		);

		const videoIds = infos.filter(info => info.type === "video").map(info => info.id);
		const playlistIds = infos.filter(info => info.type === "playlist").map(info => info.id);

		console.log(`Total ${videoIds.length} videos, ${playlistIds.length} playlists`);

		const playlistInfos = [];
		const allVideoInfos = [];

		const processVideoId = async (videoId, playlistInfo = null) => {
			const videoInfo = await this.application.youTubeVideoInfoProvider.getVideoInfo(videoId);
			allVideoInfos.push(videoInfo);

			videoInfo.playlistInfo = playlistInfo;

			if (playlistInfo) console.log(`  - ${videoInfo.title}`);
			else console.log(`${videoInfo.author} | ${videoInfo.title}`);
		};

		for (const playlistId of playlistIds) {
			const playlistInfo = await this.application.youTubeVideoInfoProvider.getPlaylistInfo(playlistId);
			playlistInfos.push(playlistInfo);

			console.log(`[${playlistInfo.author} | ${playlistInfo.title}] (${playlistInfo.videos.length} videos)`);

			for (const videoId of playlistInfo.videos.map(item => item.id)) {
				await processVideoId(videoId, playlistInfo);

				// DEBUG
				break;
			}
		}

		for (const videoId of videoIds) {
			await processVideoId(videoId);
		}

		try {
			await this.application.uploadManager.createUploader();

			for (let i = 0; i < allVideoInfos.length; i++) {
				const videoInfo = allVideoInfos[i];

				console.log();
				console.log(`Start processing ${i + 1}/${allVideoInfos.length}`);

				await this.processYouTubeVideo(videoInfo, options);

				console.log("Finish processing");
			}

			// if (!this.application.isDevelopment) await this.application.uploadManager.openDirectoryInExplorer();
		} catch (error) {
			console.error(chalk.red(error.message), chalk.red(error.cause));
			// console.error(error.stack);
		} finally {
			await this.application.uploadManager.destroyUploader();
		}
	}

	async processYouTubeVideo(videoInfo, options) {
		const isBook = Boolean(options.book);
		const isPlaylist = Boolean(videoInfo.playlistInfo);
		const isNeedInfo = isBook && Boolean(options.info);

		// fs.outputFileSync(path.resolve(this.application.userDataDirectory, "videoInfo.json"), JSON.stringify(videoInfo, null, "\t"));
		// const videoInfo = JSON.parse(fs.readFileSync(path.resolve(this.application.userDataDirectory, "videoInfo.json")).toString());

		// select first 360p mp4 video
		const formatOptions = {};

		// select opus ogg audio
		// const formatOptions = {
		// 	type: "audio",
		// 	codec: "opus",
		// 	format: "audio/webm",
		// 	quality: "best"
		// };

		const mediaStreamInfo = await this.application.youTubeVideoInfoProvider.getMediaStreamInfo(videoInfo, formatOptions);
		console.log(`${videoInfo.author} - ${videoInfo.title} (${mediaStreamInfo.duration.format("HH:mm:ss")})`);

		const chapters = this.extractChapters(videoInfo, mediaStreamInfo.duration);
		for (let i = 0; i < chapters.length; i++) console.log(`${(i + 1).toString().padStart(3, "0")} - ${chapters[i].caption}`);

		const downloadMedia = async mediaFileName => {
			const mediaDownloadingStream = await this.application.youTubeVideoInfoProvider.getMediaStream(videoInfo, formatOptions);

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

		let tempMediaFileName = path.resolve(this.application.tempDirectory, "video.mp4");

		const useMediaCache = this.application.isDevelopment;
		if (useMediaCache) {
			const videoCacheDirectory = path.resolve(this.application.userDataDirectory, "videoCache");
			fs.ensureDirSync(videoCacheDirectory);

			tempMediaFileName = path.resolve(videoCacheDirectory, `${videoInfo.id}.mp4`);

			if (!fs.existsSync(tempMediaFileName)) await downloadMedia(tempMediaFileName);
		} else {
			await downloadMedia(tempMediaFileName);
		}

		let outputDirectory;
		let outputAudioFileName;
		const videoIndexInPlaylist = isPlaylist ? videoInfo.playlistInfo.videos.findIndex(otherVideoInfo => otherVideoInfo.id === videoInfo.id) : -1;

		if (isBook) {
			if (isPlaylist) {
				outputDirectory = path.join(`${videoInfo.playlistInfo.author} - ${videoInfo.playlistInfo.title}`, `${videoIndexInPlaylist + 1} - ${videoInfo.title}`);
				outputAudioFileName = "0.m4b";
			} else {
				outputDirectory = `${videoInfo.author} - ${videoInfo.title}`;
				outputAudioFileName = "0.m4b";
			}
		} else {
			if (isPlaylist) {
				outputDirectory = `${videoInfo.playlistInfo.author} - ${videoInfo.playlistInfo.title}`;
				outputAudioFileName = `${videoIndexInPlaylist + 1} - ${videoInfo.title}.m4a`;
			} else {
				outputDirectory = ".";
				outputAudioFileName = `${videoInfo.author} - ${videoInfo.title}.m4a`;
			}
		}

		outputDirectory = filenamify(outputDirectory);
		outputAudioFileName = filenamify(outputAudioFileName);
		const outputAudioFilePath = path.join(outputDirectory, outputAudioFileName);

		console.log(`Output directory: ${this.application.uploadManager.getAbsolutePath(outputDirectory)}`);

		const tempMetadataFilePath = path.resolve(this.application.tempDirectory, "metadata.txt");
		await this.createMetadata(tempMetadataFilePath, videoInfo, chapters);

		const tempOutputAudioFilePath = path.resolve(this.application.tempDirectory, "video.mp4");

		await this.application.ffmpegManager.extractM4AudioFromMP4Video(tempMediaFileName, tempMetadataFilePath, tempOutputAudioFilePath);

		const uploadStream = fs.createReadStream(tempOutputAudioFilePath);
		const tempOutputAudioFileSize = fs.statSync(tempOutputAudioFilePath).size;

		const uploadProgressBar = new ProgressBar(tempOutputAudioFileSize);

		console.log("Uploading audio file");
		uploadProgressBar.start();

		await this.application.uploadManager.uploadFileStream(outputAudioFilePath, uploadStream, uploadedLength => { uploadProgressBar.update(uploadedLength); });

		uploadProgressBar.finish();
		process.stdout.write(ansiEscapes.eraseLines(3));

		// if (videoInfo.subtitles) {
		// 	console.log("Downloading subtitles");

		// 	const subtitlesStream = await this.application.youTubeVideoInfoProvider.getSubtitlesStream(videoInfo);
		// 	const subtitlesStr = await streamСonsumers.text(subtitlesStream);

		// 	const subtitles = SRTParser.parse(subtitlesStr);
		// 	if (subtitles.length > 0) {
		// 		await this.application.uploadManager.uploadFileStream(`${mediaDirectoryName}.txt`, stream.Readable.from(this.getSubtitlesFormattedText(subtitles, chapters)));

		// 		this.fixSubtitles(subtitles);
		// 		await this.application.uploadManager.uploadFileStream(outputAudioFileNameWithoutExtension + ".srt", stream.Readable.from(SRTParser.format(subtitles)));

		// 		console.log("Done");
		// 	} else {
		// 		console.log("No subtitles");
		// 	}
		// }

		if (isNeedInfo) {
			await this.application.uploadManager.uploadFileStream(path.join(outputDirectory, "info.json"), stream.Readable.from(JSON.stringify({
				id: videoInfo.id,
				link: "https://www.youtube.com/watch?v=" + videoInfo.id,
				channel: _.get(videoInfo, "meta.info.basic_info.channel.name"),
				channelLink: _.get(videoInfo, "meta.info.basic_info.channel.url"),
				author: videoInfo.author,
				title: videoInfo.title,
				duration: mediaStreamInfo.duration.format("HH:mm:ss"),
				chapters: chapters.map(chapter => `${chapter.start.format("HH:mm:ss")} - ${chapter.caption}`)
			}, null, "\t")));

			await this.application.uploadManager.uploadFileStream(path.join(outputDirectory, "description.txt"), stream.Readable.from(
				_.get(videoInfo, "meta.info.basic_info.short_description")
			));
		}

		if (!useMediaCache) fs.removeSync(tempMediaFileName);
		fs.removeSync(tempMetadataFilePath);
		fs.removeSync(tempOutputAudioFilePath);
	}

	extractChapters(videoInfo, mediaDuration) {
		const chapters = [];

		if (videoInfo.timings.length > 0 &&
			videoInfo.timings[0].timing.asSeconds() !== 0) chapters.push({ start: dayjs.duration({ seconds: 0 }), finish: videoInfo.timings[0].timing, caption: videoInfo.title });

		for (let i = 0; i < videoInfo.timings.length; i++) {
			const timing = videoInfo.timings[i];
			const nextTiming = i !== videoInfo.timings.length - 1 ? videoInfo.timings[i + 1] : null;
			chapters.push({ start: timing.timing, finish: nextTiming?.timing || mediaDuration, caption: timing.caption });
		}

		return chapters;
	}

	async createMetadata(metadataFilePath, videoInfo, chapters) {
		const metadataStream = fs.createWriteStream(metadataFilePath);

		metadataStream.write(`;FFMETADATA1
title=${videoInfo.title}
artist=${videoInfo.author}

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

	fixSubtitles(subtitles) {
		// на ютубе субтитры могут накладываться друг на друга что не всегда корректно работает в разных плеерах
		// сделаем, чтобы все элементы массива субтитров были последовательными

		for (let i = 1; i < subtitles.length; i++) {
			const previousItem = subtitles[i - 1];
			const currentItem = subtitles[i];

			if (previousItem.time[1] > currentItem.time[0]) {
				previousItem.text = previousItem.text.join(" ");
				currentItem.text = currentItem.text.join(" ");

				// посчитаем, сколько в процентом соотношении нужно "отрезать" символов от currentItem.text
				const percent = (previousItem.time[1] - currentItem.time[0]) / (currentItem.time[1] - currentItem.time[0]);
				let symbolsCount = Math.floor(currentItem.text.length * percent);

				// отрежем слова, чтобы примерно уложиться в symbolsCount
				const words = currentItem.text.split(" ");

				while (symbolsCount > 0) {
					symbolsCount -= words[0].length + 1;
					previousItem.text += " " + words.shift();
				}

				previousItem.text = [previousItem.text.trim()];
				currentItem.text = [words.join(" ").trim()];

				// двигаем временную метку у currentItem
				currentItem.time[0] = previousItem.time[1];
			}
		}
	}

	getSubtitlesFormattedText(subtitles, chapters) {
		const parts = [];

		let chapterIndex = 0;

		for (const subtitle of subtitles) {
			const text = subtitle.text.join(" ");

			if (chapterIndex < chapters.length) {
				const chapter = chapters[chapterIndex];
				if (subtitle.time[1] > chapter.start) {
					// TODO сделать нормально https://github.com/lis355/node-ytdwnld/issues/9
					// TODO не разрывать предложения

					// const sentenceParts = text.split(/[\.\?\!]/);
					// if (sentenceParts.length > 1) parts.push(sentenceParts[0]);

					parts.push(`\n\n${dayjs.duration(chapter.start.asMilliseconds()).format("HH:mm:ss")} ${chapter.caption}\n\n`);

					chapterIndex++;
				}
			}

			parts.push(text + " ");
		}

		return parts.join("").trim();
	}
}
