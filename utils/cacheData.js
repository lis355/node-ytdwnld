import path from "node:path";

import fs from "fs-extra";

import hash from "./hash.js";

export default async function cacheData({ isUseCache, cacheDirectory, cacheFileName, dataInfo, asyncDataGetter }) {
	let data;
	let dataFileCachePath;

	if (isUseCache) {
		cacheFileName = cacheFileName || `${hash(dataInfo)}.cache.data`;
		dataFileCachePath = path.resolve(cacheDirectory, cacheFileName);
		if (fs.existsSync(dataFileCachePath)) {
			data = fs.readFileSync(path.resolve(dataFileCachePath));

			console.log(`${JSON.stringify(dataInfo)} loaded from cache file ${cacheFileName}`);
		}
	}

	if (!data) {
		data = await asyncDataGetter(dataInfo);

		if (isUseCache) fs.outputFileSync(dataFileCachePath, data);
	}

	return data;
}
