import path from "node:path";

import { Service } from "node-windows";
import fs from "fs-extra";

const { name } = JSON.parse(fs.readFileSync("../../package.json"));

const workingDirectory = path.resolve("../..");

const svc = new Service({
	name,
	description: "",
	script: path.resolve(workingDirectory, "start.js"),
	workingDirectory
});

svc
	.on("install", () => {
		svc.start();
	})
	.on("alreadyinstalled", () => {
		console.log(`${svc.name} service is already installed`);
	})
	.on("invalidinstallation", () => {
		console.log(`${svc.name} service is invalid installed`);
	})
	.on("uninstall", () => {
		console.log(`${svc.name} service is uninstalled`);
	})
	.on("alreadyuninstalled", () => {
		console.log(`${svc.name} service is already uninstalled`);
	})
	.on("start", () => {
		console.log(`${svc.name} started`);
	})
	.on("stop", () => {
		console.log(`${svc.name} stopped`);
	})
	.on("error", error => {
		console.error(error);
	});

export default svc;
