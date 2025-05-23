import path from "node:path";

import { config as dotenv } from "dotenv-flow";
import fs from "fs-extra";

import Application from "./components/app/Application.js";

dotenv();

const application = new Application();
await application.initialize();
await application.run();

if (process.env.DEVELOPER_ENVIRONMENT === "true") {
	try {
		const onRunFilePath = path.resolve(process.cwd(), "onRun.js");
		if (fs.existsSync(onRunFilePath)) (await import(`file://${onRunFilePath}`)).default(application);
	} catch (error) {
		console.error(error);
	}
}
