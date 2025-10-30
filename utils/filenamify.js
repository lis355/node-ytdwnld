import filenamify from "filenamify";

export default function (str) {
	return filenamify(str, { replacement: "", maxLength: 128 });
}
