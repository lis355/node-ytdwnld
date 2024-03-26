import { EOL } from "node:os";

import { Telegraf, Input } from "telegraf";
import moment from "moment";

import ApplicationComponent from "./app/ApplicationComponent.js";
import AsyncQueue from "../tools/AsyncQueue.js";

const LOG_MESSAGE_LIFETIME_IN_MILLISECONDS = 10000;

export default class TelegramBot extends ApplicationComponent {
	async initialize() {
		await super.initialize();

		this.asyncQueue = new AsyncQueue();

		this.initializeBot();

		console.log("[TelegramBot]: started");
	}

	initializeBot() {
		this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

		this.bot
			.command("start", async ctx => this.sendMessage(ctx.chat.id, "Скопируйте ссылку на видео"))
			.on("message", async ctx => this.asyncQueue.push(async () => this.processTextMessage(ctx)))
			.catch((error, ctx) => {
				console.error(error);
			})
			.launch();
	}

	async processTextMessage(ctx) {
		await this.processYouTubeLink(ctx.chat.id, ctx.message.text);
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

	async processYouTubeLink(chatId, text) {
		try {
			const { youTubeDownloader } = this.application;

			const id = youTubeDownloader.parseYouTubeId(text);
			if (!id) throw new Error("Некорректая ссылка или ID");

			const info = await youTubeDownloader.getInfo(id);

			if (info.videoDetails.duration.asMinutes() > 45) throw new Error("Видео больше 45 минут временно не поддерживаются");

			const captionLines = [
				`${info.videoDetails.author.user} ${info.videoDetails.title}`
			];

			if (info.videoDetails.chapters &&
				info.videoDetails.chapters.length > 0) captionLines.push("", ...info.videoDetails.chapters.map((chapter, index) => `${index + 1}. ${chapter.title} (${moment.utc(chapter.startTime.asMilliseconds()).format("H:mm:ss")})`));

			const caption = captionLines.join(EOL);

			this.sendMessageWithAutodelete(chatId, `Загрузка видео: ${info.videoDetails.title}`);

			const deleteMessageStartLoading = await this.sendMessage(chatId, `Загрузка видео: ${info.videoDetails.title}`);

			const buffer = await youTubeDownloader.downloadYouTubeAudioFromVideo(info);

			await this.bot.telegram.sendAudio(chatId, Input.fromBuffer(buffer, `${info.videoDetails.title}.mp3`), { caption });

			await deleteMessageStartLoading();
		} catch (error) {
			await this.sendMessage(chatId, `Ошибка: ${error.message}`);
		}
	}
};
