export default async function (application) {
	const youTubeId = application.youTubeDownloader.parseVideoId("https://www.youtube.com/watch?v=xVWeRnStdSA");
	const youTubeVideoInfo = await application.youTubeDownloader.getVideoInfo(youTubeId);
	console.log(JSON.stringify(youTubeVideoInfo, null, "\t"));

	// const buffer = await application.youTubeDownloader.downloadYouTubeAudioFromVideo(youTubeVideoInfo);
}