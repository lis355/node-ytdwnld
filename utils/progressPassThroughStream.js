import stream from "node:stream";

import byteSize from "byte-size";
import cliProgress from "cli-progress";

export default function progressPassThroughStream({
	dataLength,
	onStart,
	onProgress,
	onFinish
}) {
	const dataLengthStringLength = byteSize(dataLength, { precision: 2 }).toString().length;

	const progressBar = new cliProgress.SingleBar({
		hideCursor: true,
		barCompleteChar: "\u2588",
		barIncompleteChar: "\u2591",
		barsize: 80,
		formatValue: value => byteSize(value, { precision: 2 }).toString().padStart(dataLengthStringLength, " "),
		format: (options, params, payload) => `[${cliProgress.Format.BarFormat(params.progress, options)}| ${(params.progress * 100).toFixed(2).padStart(6, " ")}% | ${options.formatValue(params.value)} / ${options.formatValue(params.total)}]`
	});

	let processedLength = 0;

	const downloadStatusStream = new stream.PassThrough()
		.on("data", chunk => {
			if (processedLength === 0) {
				if (onStart) onStart();
				progressBar.start(dataLength, 0);
			}

			processedLength += chunk.byteLength;
			if (onProgress) onProgress(processedLength);
			progressBar.update(processedLength, {});
		})
		.once("end", () => {
			progressBar.update(dataLength, {});
			progressBar.stop();
			if (onFinish) onFinish();
		});

	return downloadStatusStream;
}
