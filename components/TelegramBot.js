import { EOL } from "node:os";

import { Telegraf, Input } from "telegraf";
import async from "async";

import ApplicationComponent from "./app/ApplicationComponent.js";

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

const allowedUserIds = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS || "").split(",").map(s => Number(s.trim())).filter(Number.isFinite));

async function acessMiddleware(ctx, next) {
	return allowedUserIds.has(ctx.from.id)
		? next()
		: next(new Error("Acess denied"));
}

export default class TelegramBot extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		this.taskQueue = async.queue(async task => task());
		this.taskQueue.error(this.handleError.bind(this));

		this.lastCommands = {};

		this.initializeBot();

		console.log("[TelegramBot]: started");
	}

	initializeBot() {
		this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

		this.bot
			.use(acessMiddleware)
			.command("start", async ctx => this.sendMessage(ctx.chat.id, `${this.application.info.name} v${this.application.info.version}`))
			// .command("subs", async ctx => this.taskQueue.push(async () => this.processSubtitlesCommand(ctx)))
			.on("message", ctx => this.processTextMessage(ctx))
			.catch((error, ctx) => {
				console.error(error);
			})
			.launch();
	}

	handleError(error) {

	}

	processTextMessage(ctx) {
		// TODO write waiting

		this.taskQueue.push(async () => this.this.processYouTubeLinkCommand(ctx));
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

	async processYouTubeLinkCommand(ctx) {
		const chatId = ctx.chat.id;

		console.log(`[TelegramBot]: [processYouTubeLink] for ${ctx.chat.username} id=${chatId} text=${ctx.message.text}`);

		try {
			const { youTubeDownloader } = this.application;

			const youTubeVideoId = youTubeDownloader.parseVideoId(ctx.message.text);
			if (!youTubeVideoId) throw new Error("Некорректая ссылка или ID");

			const youTubeVideoInfo = await youTubeDownloader.getVideoInfo(youTubeVideoId);

			if (youTubeVideoInfo.videoDetails.duration.asMinutes() > 45) throw new Error("Видео больше 45 минут временно не поддерживаются");

			const captionLines = [
				`${youTubeVideoInfo.videoDetails.author.user} ${youTubeVideoInfo.videoDetails.title}`
			];

			if (youTubeVideoInfo.videoDetails.chapters &&
				youTubeVideoInfo.videoDetails.chapters.length > 0) captionLines.push("", ...youTubeVideoInfo.videoDetails.chapters.map((chapter, index) => `${index + 1}. ${chapter.title} (${moment.utc(chapter.startTime.asMilliseconds()).format("H:mm:ss")})`));

			const caption = captionLines.join(EOL);

			const deleteMessageStartLoading = await this.sendMessage(chatId, `Загрузка видео: ${youTubeVideoInfo.videoDetails.title}`);

			const buffer = await youTubeDownloader.downloadYouTubeAudioFromVideo(youTubeVideoInfo);

			await this.bot.telegram.sendAudio(chatId, Input.fromBuffer(buffer, `${youTubeVideoInfo.videoDetails.title}.mp3`), { caption });

			await deleteMessageStartLoading();

			this.lastCommands[chatId] = {
				cmd: "processYouTubeLinkCommand",
				youTubeId: youTubeVideoId,
				youTubeVideoInfo
			};
		} catch (error) {
			await this.sendMessage(chatId, `Ошибка: ${error.message}`);
		}
	}

	// async processSubtitlesCommand(ctx) {
	// 	const chatId = ctx.chat.id;

	// 	console.log(`[TelegramBot]: [processSubtitlesCommand] for ${ctx.chat.username} id=${chatId}`);

	// 	try {
	// 		const lastCommands = this.lastCommands[chatId];
	// 		if (!lastCommands ||
	// 			lastCommands.cmd !== "processYouTubeLinkCommand") throw new Error("Для получения субтитров сначала выполните команду получения аудио из видео");

	// 		const { youTubeId, youTubeVideoInfo } = this.lastCommands[chatId];

	// 		const { youTubeDownloader } = this.application;

	// 		const text = await youTubeDownloader.downloadYouTubeSubtitlesFromVideo(youTubeVideoInfo);
	// 		if (text) {
	// 			for (const chunk of chunkString(text)) await this.sendMessage(chatId, chunk);
	// 		} else await this.sendMessage(chatId, text || "Нет субтитров у видео");

	// 		this.lastCommands[chatId] = {
	// 			cmd: "processSubtitlesCommand",
	// 			youTubeId,
	// 			youTubeVideoInfo
	// 		};
	// 	} catch (error) {
	// 		await this.sendMessage(chatId, `Ошибка: ${error.message}`);
	// 	}
	// }
};
