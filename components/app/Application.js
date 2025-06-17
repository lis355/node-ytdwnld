import info from "../../package.json" with { type: "json" };

export default class Application {
	constructor() {
		process.on("uncaughtException", error => { this.onUncaughtException(error); });
		process.on("unhandledRejection", error => { this.onUnhandledRejection(error); });

		const defaultErrorHandler = error => {
			// TODO HACK https://github.com/lis355/node-ytdl-audio-telegram-bot/issues/2
			if (error.message.includes("write EOF")) return;

			console.error(error);
		};

		this.onUncaughtException = defaultErrorHandler;
		this.onUnhandledRejection = defaultErrorHandler;

		this.info = info;

		this.components = [];
	}

	addComponent(component) {
		component.application = this;

		this.components.push(component);
	}

	async initialize() {
		for (let i = 0; i < this.components.length; i++) await this.components[i].initialize();
	}

	async run() {
		for (let i = 0; i < this.components.length; i++) await this.components[i].run();
	}
}
