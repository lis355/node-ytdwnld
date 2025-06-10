import stream from "node:stream";

import byteSize from "byte-size";
import cliProgress from "cli-progress";

import ApplicationComponent from "../app/ApplicationComponent.js";

export default class YouTubeVideoInfoDownloader extends ApplicationComponent {
	async getMediaStream(videoInfo, format) {
		const streamResponse = await fetch(format.url);
		const contentLength = Number(streamResponse.headers.get("content-length"));
		if (contentLength !== format.size) throw new Error(`Bad content length ${contentLength}`);
		let downloadedLength = 0;

		const downloadProgressBar = new cliProgress.SingleBar({
			hideCursor: true,
			barCompleteChar: "\u2588",
			barIncompleteChar: "\u2591",
			barsize: 80,
			formatValue: value => byteSize(value, { precision: 2 }).toString().padStart(12, " "),
			format: (options, params, payload) => `${cliProgress.Format.BarFormat(params.progress, options)}| ${(params.progress * 100).toFixed(2).padStart(6, " ")}% | ${options.formatValue(params.value)} / ${options.formatValue(params.total)}`
		});

		const downloadStream = stream.Readable.fromWeb(streamResponse.body);

		const downloadStatusStream = new stream.PassThrough()
			.on("data", chunk => {
				if (downloadedLength === 0) {
					console.log(`Downloading ${videoInfo.author} - ${videoInfo.title} ${format.codec}`);
					downloadProgressBar.start(contentLength, 0);
				}

				downloadedLength += chunk.byteLength;
				downloadProgressBar.update(downloadedLength, {});
			})
			.once("end", () => {
				downloadProgressBar.update(contentLength, {});
				downloadProgressBar.stop();
			});

		return downloadStream.pipe(downloadStatusStream);
	}
}
