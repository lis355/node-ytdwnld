import stream from "node:stream";

import ProgressBar from "./ProgressBar.js";

export default function progressPassThroughStream({
	dataLength,
	onStart,
	onProgress,
	onFinish
}) {
	const progressBar = new ProgressBar(dataLength);

	let processedLength = 0;

	const downloadStatusStream = new stream.PassThrough()
		.on("data", chunk => {
			if (processedLength === 0) {
				if (onStart) onStart();

				progressBar.start();
			}

			processedLength += chunk.byteLength;

			if (onProgress) onProgress(processedLength);

			progressBar.update(processedLength);
		})
		.once("end", () => {
			progressBar.finish();

			if (onFinish) onFinish();
		});

	return downloadStatusStream;
}
