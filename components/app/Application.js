import TelegramBot from "../TelegramBot.js";
import YouTubeDownloader from "../downloaders/InnertubeYouTubeDownloader.js";

export default class Application {
	constructor() {
		process.on("uncaughtException", error => { this.onUncaughtException(error); });
		process.on("unhandledRejection", error => { this.onUnhandledRejection(error); });

		const defaultErrorHandler = error => {
			console.error(error);
		};

		this.onUncaughtException = defaultErrorHandler;
		this.onUnhandledRejection = defaultErrorHandler;

		this.components = [];

		this.addComponent(this.telegramBot = new TelegramBot());
		this.addComponent(this.youTubeDownloader = new YouTubeDownloader());
	}

	addComponent(component) {
		component.application = this;

		this.components.push(component);
	}

	async initialize() {
		for (let i = 0; i < this.components.length; i++) await this.components[i].initialize();

		console.log("[Application]: started");
	}

	async run() {
		for (let i = 0; i < this.components.length; i++) await this.components[i].run();
	}
}
