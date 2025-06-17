import fs from "fs-extra";

const name = "ytdwnld";
const batFilePath = `C:/windows/${name}.bat`;

fs.removeSync(batFilePath);

console.log(`${batFilePath} removed`);
