import getYouTubeID from "get-youtube-id";

import ApplicationComponent from "../app/ApplicationComponent.js";

export default class YouTubeVideoInfoProvider extends ApplicationComponent {
	parseVideoId(text) {
		if (/^[^#\&\?]{11}$/.test(text)) return text;

		const videoId = getYouTubeID((text || "").trim());
		if (!videoId) throw new Error("Bad url or text");

		return videoId;
	}

	async getVideoInfo(videoId) { throw new Error("Not implemented"); }
	async getMediaStreamInfo(videoInfo, options) { throw new Error("Not implemented"); }
	async getMediaStream(videoInfo, options) { throw new Error("Not implemented"); }
}
