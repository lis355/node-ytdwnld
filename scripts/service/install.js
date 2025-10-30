import path from "node:path";
import url from "node:url";

import fs from "fs-extra";

import { windowsBatFilePath } from "./appInfo.js";

const currentScriptDirname = path.dirname(url.fileURLToPath(import.meta.url));

fs.writeFileSync(windowsBatFilePath, `@echo off
node "${path.resolve(currentScriptDirname, "..", "start.js")}" %*
`);

console.log(`${windowsBatFilePath} created`);
