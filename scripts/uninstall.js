import fs from "fs-extra";

import { windowsBatFilePath } from "./appInfo.js";

fs.removeSync(windowsBatFilePath);

console.log(`${windowsBatFilePath} removed`);
