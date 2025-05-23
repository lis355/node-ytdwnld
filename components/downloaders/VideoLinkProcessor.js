import byteSize from "byte-size";
import cliProgress from "cli-progress";
import filenamify from "filenamify";
import fs from "fs-extra";
import LineTransformStream from "line-transform-stream";

export default class VideoLinkProcessor {
	constructor(videoInfo, format) {
		this.videoInfo = videoInfo;
		this.format = format;
	}

	async process() {
		this.streamResponse = await fetch(this.url);
		this.contentLength = Number(streamResponse.headers.get("content-length"));
		this.downloadedLength = 0;

		this.downloadProgressBar = new cliProgress.SingleBar({
			hideCursor: true,
			barCompleteChar: "\u2588",
			barIncompleteChar: "\u2591",
			barsize: 80,
			formatValue: value => byteSize(value),
			format: (options, params, payload) => `${cliProgress.Format.BarFormat(params.progress, options)}| ${(params.progress * 100).toFixed(2).padStart(6, "0")}% | ${options.formatValue(params.value)} / ${options.formatValue(params.total)}`
		});

		this.downloadStream = stream.Readable.fromWeb(streamResponse.body);
		this.downloadStatusStream = new stream.Transform({
			transform(chunk, encoding, callback) {
				this.downloadedLength += chunk.byteLength;
				this.downloadProgressBar.update(this.downloadedLength, {});

				this.push(chunk);
				callback();
			}
		})
			.once("pipe", () => {
				downloadProgressBar.start(contentLength, 0);
			})
			.once("end", () => {
				downloadProgressBar.stop();
			});


		return format.approximateDuration.asMinutes() < 40
			? this.getAudioStream()
			: this.downloadAudioParts();





		// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video
		// -i pipe:0 -c copy -map 0:a:0 -f adts -f segment -segment_time 30 "out_%03d.aac"  -- extract aac audio segments with 30 sec length from mp4 video, only to files
		// -i pipe:0 -b:a 128k -f mp3 pipe:1 -- extract audio channel to mp3


	}

	async getAudioStream() {
		// -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1 -- extract aac audio from mp4 video]

		const ffmpegConvertProcess = spawn(`"${process.env.FFMPEG_PATH}" -i pipe:0 -c copy -map 0:a:0 -f adts pipe:1`, { shell: true });

		ffmpegConvertProcess.stderr
			.pipe(new LineTransformStream(line => {
				if (line.toLowerCase().indexOf("error") >= 0) throw new Error(line);

				return line;
			}));

		await Promise.all([
			pipeline(

				// fs.createWriteStream(path.resolve("userData", "out.aac")),
				// fs.createReadStream(path.resolve("userData", "out.aac"))
				ffmpegConvertProcess.stdin
			),
			pipeline(
				ffmpegConvertProcess.stdout,
				fs.createWriteStream(outputFilePath)
			)
		]);
	}

	async downloadAudioParts() {
		const outputFilePath = path.resolve("userData", `${filenamify(videoName)}.${fileExtension}`);
		fs.ensureDirSync(path.dirname(outputFilePath));
	}
}