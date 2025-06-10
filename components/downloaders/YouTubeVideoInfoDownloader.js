import stream from "node:stream";

import byteSize from "byte-size";
import cliProgress from "cli-progress";

import ApplicationComponent from "../app/ApplicationComponent.js";

export default class YouTubeVideoInfoDownloader extends ApplicationComponent {
	async getMediaStream(videoInfo, format) {
		const streamResponse = await fetch(format.url);
		const contentLength = Number(streamResponse.headers.get("content-length"));
		if (contentLength !== format.size) throw new Error(`Bad content length ${contentLength}`);

		return stream.Readable.fromWeb(streamResponse.body);
	}
}
