import getYouTubeID from "get-youtube-id";

import ApplicationComponent from "./app/ApplicationComponent.js";

export default class YouTubeDownloader extends ApplicationComponent {
	parseVideoId(text) {
		const videoId = getYouTubeID((text || "").trim());
		if (!videoId) throw new Error("Bad url or text");

		return videoId;
	}
}
