import childProcess from "node:child_process";
import path from "node:path";
import streamPromises from "node:stream/promises";

import ansiEscapes from "ansi-escapes";
import fs from "fs-extra";
import ftp from "basic-ftp";

import ApplicationComponent from "../app/ApplicationComponent.js";

class Uploader {
	constructor(application) {
		this.application = application;
	}

	async initialize() { }
	async destroy() { }

	getAbsolutePath(localPath) { }

	async uploadFileStream(filePath, readableStream, { onUploadUpdate } = {}) { }

	async openDirectoryInExplorer(directory) { }
}

class FileSystemUploader extends Uploader {
	constructor(application, baseDirectory) {
		super(application);

		this.baseDirectory = baseDirectory;
	}

	getAbsolutePath(localPath) {
		if (path.isAbsolute(localPath)) throw new Error("Argument must be relative path");

		return path.join(this.baseDirectory, localPath);
	}

	async uploadFileStream(localFilePath, readableStream) {
		const filePath = this.getAbsolutePath(localFilePath);
		fs.ensureDirSync(path.dirname(filePath));

		await streamPromises.finished(readableStream.pipe(fs.createWriteStream(filePath)));
	}

	async openDirectoryInExplorer(localDirectory) {
		const directory = this.getAbsolutePath(localDirectory);

		childProcess.spawn("explorer.exe", [directory]);
	}
}

class FtpUploader extends Uploader {
	constructor(application, baseUrl) {
		super(application);

		this.baseUrl = new URL(baseUrl);
		this.baseDirectory = this.baseUrl.pathname;
		this.baseUrl.pathname = "";
	}

	async initialize() {
		this.client = new ftp.Client();

		// client.ftp.verbose = true;

		await this.client.access({
			host: this.baseUrl.hostname,
			port: Number(this.baseUrl.port)
		});
	}

	async destroy() {
		this.client.close();

		this.client = null;
	}

	getAbsolutePath(localPath) {
		if (path.isAbsolute(localPath)) throw new Error("Argument must be relative path");

		return path.join(this.baseDirectory, localPath);
	}

	async uploadFileStream(localFilePath, readableStream, { onUploadUpdate } = {}) {
		const filePath = this.getAbsolutePath(localFilePath);
		const fileDirectory = path.dirname(filePath);

		await this.client.cd("/");
		await this.client.ensureDir(fileDirectory);

		this.client.trackProgress(undefined);

		try {
			if (onUploadUpdate) {
				this.client.trackProgress(info => {
					onUploadUpdate(info.bytes);
				});
			}

			await this.client.uploadFrom(readableStream, filePath);
		} finally {
			this.client.trackProgress(undefined);
		}
	}

	async openDirectoryInExplorer(localDirectory) {
		childProcess.spawn("explorer.exe", [path.posix.join(this.baseUrl.origin, path.dirname(this.getAbsolutePath(localDirectory)))]);
	}
}

class TelegramBotUploader extends Uploader {
	async initialize() {
		if (!this.application.telegramBot.created) await this.application.telegramBot.createBot();

		await this.application.telegramBot.launchBot();
	}

	async destroy() {
		await this.application.telegramBot.stopBot();
	}

	getAbsolutePath(localPath) {
		if (path.isAbsolute(localPath)) throw new Error("Argument must be relative path");

		return ".";
	}

	async uploadFileStream(localFilePath, readableStream, { videoInfo, mediaStreamInfo, chapters, isOnlyAudio }) {
		await this.application.telegramBot.sendMedia(videoInfo, mediaStreamInfo, chapters, isOnlyAudio, readableStream);
	}
}

export default class YouTubeVideoInfoProvider extends ApplicationComponent {
	async createUploader() {
		this.uploader = null;

		if (!this.application.config.output) throw new Error("None output, set it in config");

		try {
			const outputDirectoryUrl = new URL(this.application.config.output);
			if (outputDirectoryUrl.protocol.toLowerCase() === "ftp:") this.uploader = new FtpUploader(this.application, outputDirectoryUrl);
		} catch (_) {
		}

		if (!this.uploader &&
			this.application.config.output === "telegram") this.uploader = new TelegramBotUploader(this.application);

		if (!this.uploader) this.uploader = new FileSystemUploader(this.application, this.application.config.output);

		console.log(`Using ${this.uploader.constructor.name} uploader with base directory ${this.application.config.output}`);
		console.log(`${this.uploader.constructor.name} uploader initializing`);
		await this.uploader.initialize();
		console.log(`${this.uploader.constructor.name} uploader initialized`);
		process.stdout.write(ansiEscapes.eraseLines(3));
	}

	async destroyUploader() {
		await this.uploader.destroy();

		this.uploader = null;
	}

	getAbsolutePath(localPath) {
		return this.uploader.getAbsolutePath(localPath);
	}

	async uploadFileStream(filePath, readableStream, onUploadUpdate) {
		await this.uploader.uploadFileStream(filePath, readableStream, onUploadUpdate);
	}

	async openDirectoryInExplorer() {
		await this.uploader.openDirectoryInExplorer();
	}
}
