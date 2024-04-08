export default function chunkString(str, len) {
	const size = Math.ceil(str.length / len);
	const result = [];
	let offset = 0;

	for (let i = 0; i < size; i++) {
		result.push(str.substr(offset, len));
		offset += len;
	}

	return result;
}
