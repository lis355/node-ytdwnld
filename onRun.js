export default async function (application) {
	const youTubeId = application.youTubeDownloader.parseYouTubeId("https://www.youtube.com/watch?v=xVWeRnStdSA");
	const youTubeVideoInfo = await application.youTubeDownloader.getInfo(youTubeId);
	const buffer = await application.youTubeDownloader.downloadYouTubeAudioFromVideo(youTubeVideoInfo);
}