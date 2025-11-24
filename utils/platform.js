import path from "node:path";

export function getApplicationDataDirectory() {
	switch (process.platform) {
		case "linux":
			return path.resolve(process.env.HOME, ".local", "share");
		case "win32":
			return path.resolve(process.env.APPDATA);
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}
