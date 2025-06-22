import childProcess from "node:child_process";
import path from "node:path";
import streamPromises from "node:stream/promises";

import ansiEscapes from "ansi-escapes";
import fs from "fs-extra";
import ftp from "basic-ftp";

import ApplicationComponent from "../app/ApplicationComponent.js";

class Uploader {
	async initialize() { }
	async destroy() { }

	async createBaseDirectory(localDirectoryPath) { }
	async uploadFileStream(fileName, readableStream) { }
	async openBaseDirectoryInExplorer() { }
}

class FileSystemUploader extends Uploader {
	constructor(baseDirectory) {
		super();

		this.baseDirectory = baseDirectory;
	}

	async createBaseDirectory(localDirectoryPath) {
		this.baseDirectory = path.resolve(this.baseDirectory, localDirectoryPath);
		fs.ensureDirSync(this.baseDirectory);
	}

	async uploadFileStream(fileName, readableStream, onUploadUpdate) {
		const outputFileStream = fs.createWriteStream(path.resolve(this.baseDirectory, fileName));

		await streamPromises.finished(readableStream.pipe(outputFileStream));
	}

	async openBaseDirectoryInExplorer() {
		childProcess.spawn("explorer.exe", [this.baseDirectory]);
	}
}

class FtpUploader extends Uploader {
	constructor(baseUrl) {
		super();

		this.baseUrl = baseUrl;
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

	async createBaseDirectory(localDirectoryPath) {
		this.baseDirectory = this.baseUrl.pathname + "/" + localDirectoryPath;

		await this.client.ensureDir(this.baseDirectory);
		await this.client.cd("/");
	}

	async uploadFileStream(fileName, readableStream, onUploadUpdate) {
		this.client.trackProgress(null);

		try {
			if (onUploadUpdate) {
				this.client.trackProgress(info => {
					onUploadUpdate(info.bytes);
				});
			}

			await this.client.uploadFrom(readableStream, this.baseDirectory + "/" + fileName);
		} finally {
			this.client.trackProgress(null);
		}
	}

	async openBaseDirectoryInExplorer() {
		childProcess.spawn("explorer.exe", [this.baseUrl.origin + this.baseDirectory]);
	}
}

export default class YouTubeVideoInfoProvider extends ApplicationComponent {
	async createUploader() {
		this.uploader = null;

		if (!this.application.config.outputDirectory) throw new Error("None outputDirectory, set it in config");

		try {
			const outputDirectoryUrl = new URL(this.application.config.outputDirectory);
			if (outputDirectoryUrl.protocol.toLowerCase() === "ftp:") this.uploader = new FtpUploader(outputDirectoryUrl);
		} catch (_) {
		}

		if (!this.uploader) this.uploader = new FileSystemUploader(this.application.config.outputDirectory);

		console.log(`Using ${this.uploader.constructor.name} uploader`);
		console.log(`${this.uploader.constructor.name} uploader initializing`);
		await this.uploader.initialize();
		console.log(`${this.uploader.constructor.name} uploader initialized`);
		process.stdout.write(ansiEscapes.eraseLines(3));
	}

	async destroyUploader() {
		await this.uploader.destroy();

		this.uploader = null;
	}

	async createBaseDirectory(localDirectoryPath) {
		await this.uploader.createBaseDirectory(localDirectoryPath);
	}

	async uploadFileStream(fileName, readableStream, onUploadUpdate) {
		await this.uploader.uploadFileStream(fileName, readableStream, onUploadUpdate);
	}

	async openBaseDirectoryInExplorer() {
		await this.uploader.openBaseDirectoryInExplorer();
	}
}
