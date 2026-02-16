import fs from "fs-extra";

export default async function doActionWithTempFiles(asyncAction) {
	const tempFilePaths = [];

	const addTempFilePath = filePath => {
		tempFilePaths.push(filePath);
	};

	try {
		await asyncAction(addTempFilePath);
	} finally {
		for (const filePath of tempFilePaths) {
			if (fs.existsSync(filePath)) fs.removeSync(filePath);
		}
	}
};
