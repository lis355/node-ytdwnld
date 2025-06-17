import path from "node:path";
import url from "node:url";

import fs from "fs-extra";

const name = "ytdwnld";
const batFilePath = `C:/windows/${name}.bat`;
const currentScriptDirname = path.dirname(url.fileURLToPath(import.meta.url));

fs.writeFileSync(batFilePath, `
@echo off
node "${path.resolve(currentScriptDirname, "..", "start.js")}" %*
`);

console.log(`${batFilePath} created`);
