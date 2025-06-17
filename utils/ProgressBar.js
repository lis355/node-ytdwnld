import byteSize from "byte-size";
import cliProgress from "cli-progress";

export default class ProgressBar {
	constructor(totalDataLength) {
		this.totalDataLength = totalDataLength;

		const totalDataLengthStringLength = byteSize(this.totalDataLengt, { precision: 2 }).toString().length;

		this.progressBar = new cliProgress.SingleBar({
			hideCursor: true,
			barCompleteChar: "\u2588",
			barIncompleteChar: "\u2591",
			barsize: 80,
			formatValue: value => byteSize(value, { precision: 2 }).toString().padStart(totalDataLengthStringLength, " "),
			format: (options, params, payload) => `[${cliProgress.Format.BarFormat(params.progress, options)}| ${(params.progress * 100).toFixed(2).padStart(6, " ")}% | ${options.formatValue(params.value)} / ${options.formatValue(params.total)}]`
		});
	}

	start() {
		this.progressBar.start(this.totalDataLength, 0);
	}

	update(processedDataLength) {
		this.progressBar.update(processedDataLength, {});
	}

	finish() {
		this.progressBar.update(this.totalDataLength, {});
		this.progressBar.stop();
	}
}
