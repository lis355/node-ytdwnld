const ALLOWED_CHARS = "0123456789-+=_ ";

function isLetterUnicode(char) {
	return typeof char === "string" &&
		char.length === 1 &&
		char.toLowerCase() !== char.toUpperCase();
}

export default function filenamify(str, { ignoreCase = false, maxLength = 128 } = {}) {
	// To ensure cross-platform compatibility, use only lowercase letters (a-z), numbers (0-9), hyphens (-), and underscores (_).
	//  Avoid spaces and special characters like /:*?"<>|, and keep filenames concise. 
	// While Windows is not case-sensitive, Unix-like systems (Linux, macOS) are, so lowercase is recommended for consistency across all systems. 

	let result = "";

	const length = Math.max(str.length, maxLength);
	for (let i = 0; i < length; i++) {
		const char = str.charAt(i);
		if (isLetterUnicode(char) ||
			ALLOWED_CHARS.includes(char)) result += ignoreCase ? char.toLowerCase() : char;
	}

	return result;
}
