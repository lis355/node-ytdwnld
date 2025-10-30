import { EOL } from "node:os";
import path from "node:path";
import stream from "node:stream";
import streamPromises from "node:stream/promises";
import streamСonsumers from "node:stream/consumers";

import { Telegraf, Input } from "telegraf";
import async from "async";
import fs from "fs-extra";

import ApplicationComponent from "./app/ApplicationComponent.js";
import dayjs from "../utils/dayjs.js";
import filenamify from "../utils/filenamify.js";
import SRTParser from "../utils/srt.js";

const MAX_MESSAGE_LENGTH = 4096;
const LOG_MESSAGE_LIFETIME_IN_MILLISECONDS = 10000;

function chunkString(str, chunkLength = MAX_MESSAGE_LENGTH) {
	const size = Math.ceil(str.length / chunkLength);
	const result = [];
	let offset = 0;

	for (let i = 0; i < size; i++) {
		result.push(str.substr(offset, chunkLength));
		offset += chunkLength;
	}

	return result;
}

export default class TelegramBot extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		this.taskQueue = async.queue(async ({ ctx, action }) => action());
		this.taskQueue.error(async (error, { ctx, action }) => {
			await this.sendMessage(ctx.chat.id, `Ошибка: ${error.message}`);
		});
	}

	async createBot() {
		const token = this.application.config.telegramBotToken;
		if (!token) {
			console.error("Telegram bot token is not defined in config file as option \"telegramBotToken\", please, edit config file");

			return this.application.exit(1);
		}

		this.bot = new Telegraf(token);

		if (!Number.isFinite(this.application.config.telegramBotUserId)) {
			console.error("Telegram bot reciever user id \"telegramBotUserId\", please, edit config file");

			return this.application.exit(1);
		}

		const allowedUserIds = new Set([this.application.config.telegramBotUserId]);

		async function acessMiddleware(ctx, next) {
			return allowedUserIds.has(ctx.from.id)
				? next()
				: next(new Error("Access denied"));
		}

		this.bot
			.use(acessMiddleware);

		if (this.application.isDevelopment) {
			this.bot.use((ctx, next) => {
				console.log(`[TelegramBot]: ${ctx.chat.username} id=${ctx.chat.id} text=${ctx.message.text}`);

				return next();
			});
		}

		this.bot
			.command("start", async ctx => this.sendMessage(ctx.chat.id, `${this.application.info.name} v${this.application.info.version}`))
			// .command("subs", async ctx => this.processSubtitlesCommand(ctx))
			.on("message", ctx => this.processTextMessage(ctx))
			.catch((error, ctx) => {
				throw error;
			});

		this.created = true;
	}

	async launchBot() {
		if (this.lauching) throw new Error("Bot is launching");
		if (this.launched) throw new Error("Bot is already launched");

		this.lauching = true;
		this.launched = false;

		await new Promise((resolve, reject) => {
			this.bot
				.launch(
					{
						// dropPendingUpdates: true
					},
					() => {
						this.lauching = false;
						this.launched = true;

						console.log("[TelegramBot]: started");

						return resolve();
					}
				);
		});
	}

	async stopBot() {
		if (this.lauching) throw new Error("Bot is launching");
		if (!this.launched) throw new Error("Bot is not launched");

		this.bot.stop();

		this.lauching = false;
		this.launched = false;

		console.log("[TelegramBot]: stopped");
	}

	async sendMessage(chatId, message) {
		const replyMessageInfo = await this.bot.telegram.sendMessage(chatId, message);

		const deleteMessage = async () => this.deleteMessage(chatId, replyMessageInfo["message_id"]);

		return deleteMessage;
	}

	async sendMessageWithAutodelete(chatId, message) {
		const deleteMessage = await this.sendMessage(chatId, message);

		setTimeout(deleteMessage, LOG_MESSAGE_LIFETIME_IN_MILLISECONDS);
	}

	async deleteMessage(chatId, messageId) {
		await this.bot.telegram.deleteMessage(chatId, messageId);
	}

	// async processTextMessage(ctx) {
	// 	const chatId = ctx.chat.id;

	// 	console.log("[TelegramBot]: processTextMessage", ctx.chat.username, chatId, ctx.message.text);

	// 	let videoId;
	// 	try {
	// 		videoId = this.application.youTubeVideoInfoProvider.parseVideoId(ctx.message.text.trim());
	// 	} catch (error) {
	// 		await this.sendMessage(chatId, "Некорректая ссылка или ID");

	// 		return;
	// 	}

	// 	const videoInfo = await this.application.youTubeVideoInfoProvider.getVideoInfo(videoId);
	// 	const videoCaption = `${videoInfo.author} - ${videoInfo.title}`;

	// 	const formatOptions = {};
	// 	const mediaStreamInfo = await this.application.youTubeVideoInfoProvider.getMediaStreamInfo(videoInfo, formatOptions);
	// 	const mediaDuration = dayjs.duration(mediaStreamInfo["approx_duration_ms"]);

	// 	const deleteProcessingMessage = await this.sendMessage(chatId, `Обработка видео${EOL}${videoCaption} (${mediaDuration.format("HH:mm:ss")})`);

	// 	this.taskQueue.push({
	// 		ctx, action: async () => {
	// 			const downloadMedia = async mediaFileName => {
	// 				console.log("[TelegramBot]: downloading video", `${videoCaption} (${mediaDuration.format("HH:mm:ss")})`);

	// 				const mediaDownloadingStream = await this.application.youTubeVideoInfoProvider.getMediaStream(videoInfo, formatOptions);

	// 				await streamPromises.finished(
	// 					mediaDownloadingStream
	// 						.pipe(fs.createWriteStream(mediaFileName))
	// 				);
	// 			};

	// 			let tempMediaFileName = path.resolve(this.application.tempDirectory, `${videoId}.mp4`);

	// 			const useMediaCache = this.application.isDevelopment;
	// 			if (useMediaCache) {
	// 				const videoCacheDirectory = path.resolve(this.application.userDataDirectory, "videoCache");
	// 				fs.ensureDirSync(videoCacheDirectory);

	// 				tempMediaFileName = path.resolve(videoCacheDirectory, `${videoId}.mp4`);

	// 				if (!fs.existsSync(tempMediaFileName)) await downloadMedia(tempMediaFileName);
	// 			} else {
	// 				await downloadMedia(tempMediaFileName);
	// 			}

	// 			const chapters = this.application.youTubeVideoDownloader.extractChapters(videoInfo, mediaDuration);

	// 			const tempMetadataFilePath = path.resolve(this.application.tempDirectory, `${videoId}.metadata.txt`);
	// 			await this.application.youTubeVideoDownloader.createMetadata(tempMetadataFilePath, videoInfo, chapters);

	// 			const tempOutputAudioFilePath = path.resolve(this.application.tempDirectory, `${videoId}.m4b`);

	// 			await this.application.ffmpegManager.extractM4AudioFromMP4Video(tempMediaFileName, tempMetadataFilePath, tempOutputAudioFilePath);

	// 			await this.sendMedia(videoInfo, tempOutputAudioFilePath);

	// 			await deleteProcessingMessage();

	// 			fs.removeSync(tempMediaFileName);
	// 			tempOutputAudioPartFilePaths.forEach(tempOutputAudioPartFilePath => fs.removeSync(tempOutputAudioPartFilePath));
	// 			fs.removeSync(tempMetadataFilePath);
	// 			fs.removeSync(tempOutputAudioFilePath);
	// 		}
	// 	});
	// }

	async sendMedia(videoInfo, mediaStreamInfo, chapters, isOnlyAudio, readableStream) {
		const chatId = this.application.config.telegramBotUserId;

		const captionLines = [
			`${videoInfo.author} - ${videoInfo.title} (${mediaStreamInfo.duration.format("HH:mm:ss")})`
		];

		if (chapters.length > 0) captionLines.push("", ...chapters.map(chapter => `${chapter.start.format("HH:mm:ss")} ${chapter.caption}`));

		const caption = captionLines.join(EOL);

		const mediaFileNameWithoutExtension = `${videoInfo.author} - ${videoInfo.title}`;

		if (isOnlyAudio) {
			const tempOutputAudioPartFilePaths = [];
			const mediaGroupAudioDocuments = [];

			// https://core.telegram.org/bots/api#sending-files
			// Post the file using multipart/form-data in the usual way that files are uploaded via the browser. 10 MB max size for photos, 50 MB for other files.
			// aac 96 kbps quality 65 minutes size estimated file size is around 45 MB
			const maximumAudioDuration = dayjs.duration(65, "minutes");
			if (mediaStreamInfo.duration > maximumAudioDuration) {
				await this.application.ffmpegManager.splitM4AudioIntoParts(tempOutputAudioFilePath, tempOutputAudioFilePath, mediaStreamInfo.duration, maximumAudioDuration, tempOutputAudioPartFilePaths);

				tempOutputAudioPartFilePaths.forEach((tempOutputAudioPartFilePath, index) => {
					mediaGroupAudioDocuments.push({
						media: Input.fromLocalFile(tempOutputAudioPartFilePath, filenamify(`${mediaFileNameWithoutExtension}.${index.toString().padStart(2, "0")}.m4a`)),
						type: "audio",
						caption: index === tempOutputAudioPartFilePaths.length - 1 ? caption : undefined
					});
				});
			} else {
				mediaGroupAudioDocuments.push({
					media: Input.fromReadableStream(readableStream, filenamify(`${mediaFileNameWithoutExtension}.m4a`)),
					type: "audio",
					caption
				});
			}

			// can't send media group with summary size more than 50 mb
			// await this.bot.telegram.sendMediaGroup(chatId, mediaGroupAudioDocuments);
			for (const mediaGroupAudioDocument of mediaGroupAudioDocuments) await this.bot.telegram.sendAudio(chatId, mediaGroupAudioDocument.media, { caption: mediaGroupAudioDocument.caption });
		} else {
			await this.bot.telegram.sendVideo(chatId, Input.fromReadableStream(readableStream, filenamify(`${mediaFileNameWithoutExtension}.mp4`)), { caption });
		}

		// if (videoInfo.subtitles) {
		// 	const subtitlesStream = await this.application.youTubeVideoInfoProvider.getSubtitlesStream(videoInfo);
		// 	const subtitlesStr = await streamСonsumers.text(subtitlesStream);

		// 	const subtitles = SRTParser.parse(subtitlesStr);
		// 	if (subtitles.length > 0) {
		// 		const subtitlesFormattedText = this.application.youTubeVideoDownloader.getSubtitlesFormattedText(subtitles, chapters);

		// 		this.application.youTubeVideoDownloader.fixSubtitles(subtitles);

		// 		await this.bot.telegram.sendMediaGroup(chatId, [
		// 			{
		// 				media: Input.fromReadableStream(stream.Readable.from(SRTParser.format(subtitles)), filenamify(`${videoCaption}.srt`)),
		// 				type: "document"
		// 			},
		// 			{
		// 				media: Input.fromReadableStream(stream.Readable.from(subtitlesFormattedText), filenamify(`${videoCaption}.txt`)),
		// 				type: "document"
		// 			}
		// 		]);
		// 	}
		// }
	}
};
