import { EOL } from "node:os";
import path from "node:path";
// import stream from "node:stream";
import streamPromises from "node:stream/promises";
// import streamСonsumers from "node:stream/consumers";

import { Telegraf, Input } from "telegraf";
import { SocksProxyAgent } from "socks-proxy-agent";
import async from "async";
import fs from "fs-extra";

import ApplicationComponent from "./app/ApplicationComponent.js";
import dayjs from "../utils/dayjs.js";
import doActionWithTempFiles from "../utils/doActionWithTempFiles.js";
import filenamify from "../utils/filenamify.js";
// import SRTParser from "../utils/srt.js";

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

		this.taskQueue = async.queue(async ({ ctx, action }) => action(ctx));
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

		const options = {
			telegram: {}
		};

		if (this.application.config.telegramBotSocks5Proxy) options.telegram.agent = new SocksProxyAgent(this.application.config.telegramBotSocks5Proxy);

		this.bot = new Telegraf(token, options);

		const telegramBotUserIds = this.application.config.telegramBotUserIds.filter(Number.isFinite);
		if (telegramBotUserIds.length === 0) {
			console.error("Telegram bot reciever user id \"telegramBotUserIds\" are not valid, please, edit config file");

			return this.application.exit(1);
		}

		const allowedUserIds = new Set(this.application.config.telegramBotUserIds);

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

		// await this.processVideoId(this.application.config.telegramBotUserIds[0], "");
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

	async processTextMessage(ctx) {
		console.log("[TelegramBot]: processTextMessage", ctx.chat.username, `[${ctx.from.id}]`, `chatId=${ctx.chat.id}`, ctx.message.text);

		await this.processTextMessageAsVideoId(ctx);
	}

	async processTextMessageAsVideoId(ctx) {
		let videoId;
		try {
			const videoIdInfo = this.application.youTubeVideoInfoProvider.parseId(ctx.message.text.trim());

			if (!videoIdInfo.parsed) throw new Error("Bad ID");
			if (videoIdInfo.type !== "video") throw new Error("It is not video");

			videoId = videoIdInfo.id;
		} catch (error) {
			console.log(error);

			await this.sendMessage(ctx.chat.id, "Некорректая ссылка или ID");

			return;
		}

		this.taskQueue.push({
			ctx,
			action: async ctx => {
				await this.processVideoId(ctx.chat.id, videoId);
			}
		});
	}

	async processVideoId(chatId, videoId) {
		const videoInfo = await this.application.youTubeVideoInfoProvider.getVideoInfo(videoId);
		const videoCaption = `${videoInfo.author} - ${videoInfo.title}`;

		const formatOptions = {};
		const mediaStreamInfo = await this.application.youTubeVideoInfoProvider.getMediaStreamInfo(videoInfo, formatOptions);

		console.log("[TelegramBot]: processing video", `${videoCaption} (${mediaStreamInfo.duration.format("HH:mm:ss")})`);

		const deleteProcessingMessage = await this.sendMessage(chatId, `Обработка видео${EOL}${videoCaption} (${mediaStreamInfo.duration.format("HH:mm:ss")})`);

		const downloadMedia = async mediaFileName => {
			console.log("[TelegramBot]: downloading video");

			const mediaDownloadingStream = await this.application.youTubeVideoInfoProvider.getMediaStream(videoInfo, formatOptions);

			await streamPromises.finished(
				mediaDownloadingStream
					.pipe(fs.createWriteStream(mediaFileName))
			);
		};

		await doActionWithTempFiles(async addTempFilePath => {
			try {
				let tempMediaFileName = path.resolve(this.application.tempDirectory, `${videoId}.mp4`);

				const useMediaCache = this.application.isDevelopment;
				if (useMediaCache) {
					const videoCacheDirectory = path.resolve(this.application.userDataDirectory, "videoCache");
					fs.ensureDirSync(videoCacheDirectory);

					tempMediaFileName = path.resolve(videoCacheDirectory, `${videoId}.mp4`);

					if (!fs.existsSync(tempMediaFileName)) await downloadMedia(tempMediaFileName);
				} else {
					addTempFilePath(tempMediaFileName);

					await downloadMedia(tempMediaFileName);
				}

				const chapters = this.application.youTubeVideoDownloader.extractChapters(videoInfo, mediaStreamInfo.duration);

				const tempMetadataFilePath = path.resolve(this.application.tempDirectory, `${videoId}.metadata.txt`);
				addTempFilePath(tempMetadataFilePath);
				await this.application.youTubeVideoDownloader.createMetadata(tempMetadataFilePath, videoInfo, chapters);

				const tempOutputAudioFilePath = path.resolve(this.application.tempDirectory, `${videoId}.m4b`);
				addTempFilePath(tempOutputAudioFilePath);

				console.log("[TelegramBot]: processing video with ffmpeg");

				await this.application.ffmpegManager.extractM4AudioFromMP4VideoAndInjectMetadata(tempMediaFileName, tempMetadataFilePath, tempOutputAudioFilePath);

				const captionLines = [
					`${videoInfo.author} - ${videoInfo.title} (${mediaStreamInfo.duration.format("HH:mm:ss")})`
				];

				if (chapters.length > 0) captionLines.push("", ...chapters.map(chapter => `${chapter.start.format("HH:mm:ss")} ${chapter.caption}`));

				const caption = captionLines.join(EOL);

				const mediaFileNameWithoutExtension = `${videoInfo.author} - ${videoInfo.title}`;

				const mediaGroupAudioDocuments = [];

				// if video ...
				// await this.bot.telegram.sendVideo(chatId, Input.fromReadableStream(readableStream, filenamify(`${mediaFileNameWithoutExtension}.mp4`)), { caption });

				// https://core.telegram.org/bots/api#sending-files
				// Post the file using multipart/form-data in the usual way that files are uploaded via the browser. 10 MB max size for photos, 50 MB for other files.
				// aac 96 kbps quality 65 minutes size estimated file size is around 45 MB
				// 60 minutes == 1 h more usable
				const maximumAudioDuration = dayjs.duration(60, "minutes");
				if (mediaStreamInfo.duration > maximumAudioDuration) {
					console.log("[TelegramBot]: video too long, splitting into parts");

					const tempOutputAudioPartFilePaths = [];
					await this.application.ffmpegManager.splitM4AudioIntoParts(tempOutputAudioFilePath, tempOutputAudioFilePath, mediaStreamInfo.duration, maximumAudioDuration, tempOutputAudioPartFilePaths);

					tempOutputAudioPartFilePaths.forEach((tempOutputAudioPartFilePath, index) => {
						addTempFilePath(tempOutputAudioPartFilePath);

						mediaGroupAudioDocuments.push({
							media: Input.fromLocalFile(tempOutputAudioPartFilePath, filenamify(`${mediaFileNameWithoutExtension}.${index.toString().padStart(2, "0")}.m4a`)),
							type: "audio"
						});
					});
				} else {
					mediaGroupAudioDocuments.push({
						media: Input.fromLocalFile(tempOutputAudioFilePath, filenamify(`${mediaFileNameWithoutExtension}.m4a`)),
						type: "audio"
					});
				}

				console.log(`[TelegramBot]: sending audio with ${mediaGroupAudioDocuments.length} parts`);

				const captionMessages = chunkString(caption, 1024);
				for (const captionMessage of captionMessages) await this.sendMessage(chatId, captionMessage);

				// can't send media group with summary size more than 50 mb
				// await this.bot.telegram.sendMediaGroup(chatId, mediaGroupAudioDocuments);
				for (const mediaGroupAudioDocument of mediaGroupAudioDocuments) await this.bot.telegram.sendAudio(chatId, mediaGroupAudioDocument.media);

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
			} catch (error) {
				console.log(error);

				await this.sendMessage(chatId, `Ошибка при обработке видео ${videoId}`);
			} finally {
				await deleteProcessingMessage();

				console.log("[TelegramBot]: done with video", `${videoCaption} (${mediaStreamInfo.duration.format("HH:mm:ss")})`);
			}
		});
	}
};
