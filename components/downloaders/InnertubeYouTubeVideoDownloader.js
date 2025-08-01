import path from "node:path";
import stream from "node:stream";
import streamСonsumers from "node:stream/consumers";
import streamPromises from "node:stream/promises";

import _ from "lodash";
import ansiEscapes from "ansi-escapes";
import filenamify from "filenamify";
import fs from "fs-extra";

import ApplicationComponent from "../app/ApplicationComponent.js";
import dayjs from "../../utils/dayjs.js";
import ProgressBar from "../../utils/ProgressBar.js";
import progressPassThroughStream from "../../utils/progressPassThroughStream.js";
import SRTParser from "../../utils/srt.js";

export default class InnertubeYouTubeVideoDownloader extends ApplicationComponent {
	async initialize() {
		await super.initialize();
	}

	async processYouTubeIds(args) {
		const youTubeIds = Array.from(new Set(args.map(arg => arg.split(",")).flat().map(s => s.trim()).filter(Boolean)))
			.map(videoUrlOrId => this.application.youTubeVideoInfoProvider.parseVideoId(videoUrlOrId));

		console.log(`Total ${youTubeIds.length} videos: ${youTubeIds.join(", ")}`);

		await this.application.uploadManager.createUploader();

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
			if (this.application.uploadManager.uploader) await this.application.uploadManager.destroyUploader();
		}
	}

	async processYouTubeId(youTubeId) {
		const youTubeVideoInfo = await this.application.youTubeVideoInfoProvider.getVideoInfo(youTubeId);

		// fs.outputFileSync(path.resolve(this.application.userDataDirectory, "youTubeVideoInfo.json"), JSON.stringify(youTubeVideoInfo, null, "\t"));
		// const youTubeVideoInfo = JSON.parse(fs.readFileSync(path.resolve(this.application.userDataDirectory, "youTubeVideoInfo.json")).toString());

		// select first 360p mp4 video
		const formatOptions = {};

		// select opus ogg audio
		// const formatOptions = {
		// 	type: "audio",
		// 	codec: "opus",
		// 	format: "audio/webm",
		// 	quality: "best"
		// };

		const mediaStreamInfo = await this.application.youTubeVideoInfoProvider.getMediaStreamInfo(youTubeVideoInfo, formatOptions);
		const mediaDuration = dayjs.duration(mediaStreamInfo["approx_duration_ms"]);
		console.log(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title} (${mediaDuration.format("HH:mm:ss")})`);

		const chapters = this.extractChapters(youTubeVideoInfo, mediaDuration);
		for (let i = 0; i < chapters.length; i++) console.log(`${(i + 1).toString().padStart(3, "0")} - ${chapters[i].caption}`);

		const downloadMedia = async mediaFileName => {
			const mediaDownloadingStream = await this.application.youTubeVideoInfoProvider.getMediaStream(youTubeVideoInfo, formatOptions);

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

		let tempMediaFileName = path.resolve(this.application.tempDirectory, "0.mp4");

		const useMediaCache = this.application.isDevelopment;
		if (useMediaCache) {
			const videoCacheDirectory = path.resolve(this.application.userDataDirectory, "videoCache");
			fs.ensureDirSync(videoCacheDirectory);

			tempMediaFileName = path.resolve(videoCacheDirectory, `${youTubeId}.mp4`);

			if (!fs.existsSync(tempMediaFileName)) await downloadMedia(tempMediaFileName);
		} else {
			await downloadMedia(tempMediaFileName);
		}

		const mediaDirectoryName = filenamify(`${youTubeVideoInfo.author} - ${youTubeVideoInfo.title}`, { replacement: "", maxLength: 128 });

		await this.application.uploadManager.createBaseDirectory(mediaDirectoryName);

		const tempMetadataFilePath = path.resolve(this.application.tempDirectory, "metadata.txt");
		await this.createMetadata(tempMetadataFilePath, youTubeVideoInfo, chapters);

		const outputAudioFileNameWithoutExtension = "0";
		const outputAudioFileName = outputAudioFileNameWithoutExtension + ".m4b";
		const tempOutputAudioFilePath = path.resolve(this.application.tempDirectory, outputAudioFileName);

		await this.application.ffmpegManager.extractM4AudioFromMP4Video(tempMediaFileName, tempMetadataFilePath, tempOutputAudioFilePath);

		const uploadStream = fs.createReadStream(tempOutputAudioFilePath);
		const tempOutputAudioFileSize = fs.statSync(tempOutputAudioFilePath).size;

		const uploadProgressBar = new ProgressBar(tempOutputAudioFileSize);

		console.log("Uploading audio file");
		uploadProgressBar.start();

		await this.application.uploadManager.uploadFileStream(outputAudioFileName, uploadStream, uploadedLength => { uploadProgressBar.update(uploadedLength); });

		uploadProgressBar.finish();
		process.stdout.write(ansiEscapes.eraseLines(3));

		if (youTubeVideoInfo.subtitles) {
			console.log("Downloading subtitles");

			const subtitlesStream = await this.application.youTubeVideoInfoProvider.getSubtitlesStream(youTubeVideoInfo);
			const subtitlesStr = await streamСonsumers.text(subtitlesStream);

			const subtitles = SRTParser.parse(subtitlesStr);
			if (subtitles.length > 0) {
				await this.application.uploadManager.uploadFileStream(`${mediaDirectoryName}.txt`, stream.Readable.from(this.getSubtitlesFormattedText(subtitles, chapters)));

				this.fixSubtitles(subtitles);
				await this.application.uploadManager.uploadFileStream(outputAudioFileNameWithoutExtension + ".srt", stream.Readable.from(SRTParser.format(subtitles)));

				console.log("Done");
			} else {
				console.log("No subtitles");
			}
		}

		await this.application.uploadManager.uploadFileStream("info.json", stream.Readable.from(JSON.stringify({
			id: youTubeVideoInfo.id,
			link: "https://www.youtube.com/watch?v=" + youTubeVideoInfo.id,
			channel: _.get(youTubeVideoInfo, "meta.info.basic_info.channel.name"),
			channelLink: _.get(youTubeVideoInfo, "meta.info.basic_info.channel.url"),
			author: youTubeVideoInfo.author,
			title: youTubeVideoInfo.title,
			duration: mediaDuration.format("HH:mm:ss"),
			chapters: chapters.map(chapter => `${chapter.start.format("HH:mm:ss")} - ${chapter.caption}`)
		}, null, "\t")));

		if (!useMediaCache) fs.removeSync(tempMediaFileName);
		fs.removeSync(tempMetadataFilePath);
		fs.removeSync(tempOutputAudioFilePath);

		// if (!this.application.isDevelopment) await this.application.uploadManager.openBaseDirectoryInExplorer();
	}

	extractChapters(youTubeVideoInfo, mediaDuration) {
		const chapters = [];

		if (youTubeVideoInfo.timings.length > 0 &&
			youTubeVideoInfo.timings[0].timing.asSeconds() !== 0) chapters.push({ start: dayjs.duration({ seconds: 0 }), finish: youTubeVideoInfo.timings[0].timing, caption: youTubeVideoInfo.title });

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
