import childProcess from "node:child_process";
import path from "node:path";

import _ from "lodash";
import { config as dotenv } from "dotenv-flow";
import * as commander from "commander";
import fs from "fs-extra";
import YAML from "yaml";

import Application from "./components/app/Application.js";
import filenamify from "./utils/filenamify.js";

import info from "./package.json" with { type: "json" };
import chalk from "chalk";

dotenv({
	path: import.meta.dirname
});

const isDevelopment = Boolean(process.env.VSCODE_INJECTION &&
	process.env.VSCODE_INSPECTOR_OPTIONS);

const BASE_CONFIG = {
	outputDirectory: "",
	proxy: "",
	telegramBotToken: "",
	telegramBotAllowedUserIds: ""
};

class App extends Application {
	constructor() {
		super();

		this.info = info;

		this.printLogo();
	}

	printLogo() {
		const logo = `
          __      __               __    __
   __  __/ /_____/ /      ______  / /___/ /
  / / / / __/ __  / | /| / / __ \\/ / __  / 
 / /_/ / /_/ /_/ /| |/ |/ / / / / / /_/ /  
 \\__, /\\__/\\__,_/ |__/|__/_/ /_/_/\\__,_/   
/____/                     ############
`.replace("############", `v ${this.info.version}`.padStart(12, " "));

		console.log(logo);
	}

	get isDevelopment() {
		return isDevelopment;
	}

	async initialize() {
		this.createUserDataDirectory();
		this.createTemporaryDirectory();
		this.createConfig();

		const { default: FFMpegManager } = await import("./components/FFMpegManager.js");
		const { default: TelegramBot } = await import("./components/TelegramBot.js");
		const { default: UploadManager } = await import("./components/uploaders/UploadManager.js");
		const { default: YouTubeVideoDownloader } = await import("./components/downloaders/InnertubeYouTubeVideoDownloader.js");
		const { default: YouTubeVideoInfoProvider } = await import("./components/downloaders/InnertubeYouTubeVideoInfoProvider.js");

		this.addComponent(this.ffmpegManager = new FFMpegManager());
		this.addComponent(this.youTubeVideoInfoProvider = new YouTubeVideoInfoProvider());
		this.addComponent(this.youTubeVideoDownloader = new YouTubeVideoDownloader());
		this.addComponent(this.uploadManager = new UploadManager());
		this.addComponent(this.telegramBot = new TelegramBot());

		await super.initialize();
	}

	createUserDataDirectory() {
		this.userDataDirectory = this.isDevelopment
			? path.resolve(import.meta.dirname, "userData")
			: path.resolve(process.env.APPDATA, filenamify(this.info.name));

		fs.ensureDirSync(this.userDataDirectory);
	}

	createTemporaryDirectory() {
		this.tempDirectory = path.resolve(this.userDataDirectory, "temp");

		fs.ensureDirSync(this.tempDirectory);
	}

	clearTemporaryDirectory() {
		fs.removeSync(this.tempDirectory);
	}

	createConfig() {
		this.configPath = path.resolve(this.userDataDirectory, "config.yaml");

		let userConfig;
		if (fs.existsSync(this.configPath)) {
			try {
				userConfig = YAML.parse(fs.readFileSync(this.configPath).toString());
			} catch (error) {
				console.error(`Error in reading config file: ${this.configPath}, please, edit or remove it`);

				return this.application.exit(1);
			}
		}

		this.config = _.merge({}, BASE_CONFIG, userConfig);

		if (!userConfig) fs.outputFileSync(this.configPath, YAML.stringify(this.config));
	}

	async run() {
		await super.run();

		if (isDevelopment) console.warn(chalk.yellow("[isDevelopment]"));
		console.log(`${chalk.green("[userDataDirectory]:")} ${this.userDataDirectory}`);
		console.log(`${chalk.green("[config]:")} ${this.configPath}`);
		console.log(`${chalk.green("[config.outputDirectory]:")} ${this.config.outputDirectory}`);
	}

	async exit(code = 0) {
		this.clearTemporaryDirectory();

		await super.exit(code);
	}
}

const application = new App();

const program = new commander.Command();
program
	.name(application.info.name)
	.version(application.info.version)
	.description("Application to download youtube videos as audio and upload/save to Filesystem/FTP");

program.showHelpAfterError();

async function runApplication() {
	await application.initialize();
	await application.run();
}

async function runApplicationWithActionAndExit(asyncAction) {
	await runApplication();

	let wasError = false;
	try {
		await asyncAction();
	} catch (error) {
		wasError = true;
		application.onUncaughtException(error);
	} finally {
		await application.exit(wasError ? 1 : 0);
	}
}

program
	.command("config")
	.description("Open config file")
	.action(async () => {
		await runApplicationWithActionAndExit(async () => {
			const process = childProcess.spawn("explorer.exe", [application.configPath]);

			await new Promise(resolve => process.once("exit", resolve));
		});
	});

program
	.command("download", { isDefault: true })
	.description("Download media from YouTube")
	.argument("<items...>", "youtube video urls/ids/playlist urls/ids comma separated")
	.option("-a, --audio", "Download only audio")
	.option("-b, --book", "Place every media to specific folder")
	.option("-i, --info", "Write video information with description (work only with --book flag)")
	.option("-t, --telegram", "Upload to telegram bot")
	.action(async (name, options, command) => {
		await runApplicationWithActionAndExit(async () => {
			await application.youTubeVideoDownloader.processYouTubeIds(command.args, options);
		});
	});

program
	.command("bot")
	.description("Start telegram bot to download videos")
	.action(async () => {
		await runApplication();

		await application.telegramBot.createBot();
	});

program
	.parse(
		isDevelopment
			? [...process.argv.slice(0, 2), ...(process.env.DEVELOPMENT_ARGS || "").split(" ").map(s => s.trim()).filter(Boolean)]
			: undefined
	);
