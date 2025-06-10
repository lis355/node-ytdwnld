import path from "node:path";

import { config as dotenv } from "dotenv-flow";
import fs from "fs-extra";

import Application from "./components/app/Application.js";
import TelegramBot from "./components/TelegramBot.js";
import YouTubeDownloader from "./components/downloaders/InnertubeYouTubeDownloader.js";

dotenv();

class App extends Application {
	constructor() {
		super();

		this.addComponent(this.telegramBot = new TelegramBot());
		this.addComponent(this.youTubeDownloader = new YouTubeDownloader());
	}
}

const application = new App();
await application.initialize();
await application.run();

if (process.env.DEVELOPER_ENVIRONMENT === "true") {
	try {
		const onRunFilePath = path.resolve(process.cwd(), "onRun.js");
		if (fs.existsSync(onRunFilePath)) (await import(`file://${onRunFilePath}`)).default(application);
	} catch (error) {
		console.error(error);
	}
}
