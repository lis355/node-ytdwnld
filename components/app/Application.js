export default class Application {
	constructor() {
		process.on("uncaughtException", error => { this.onUncaughtException(error); });
		process.on("unhandledRejection", error => { this.onUnhandledRejection(error); });

		const defaultErrorHandler = error => {
			console.error(error);
		};

		this.onUncaughtException = defaultErrorHandler;
		this.onUnhandledRejection = defaultErrorHandler;

		this.components = [];
	}

	addComponent(component) {
		component.application = this;

		this.components.push(component);
	}

	async initialize() {
		for (let i = 0; i < this.components.length; i++) await this.components[i].initialize();
	}

	async run() {
		for (let i = 0; i < this.components.length; i++) await this.components[i].run();
	}

	async exit(code = 0) {
		for (let i = 0; i < this.components.length; i++) await this.components[i].exit();

		process.exit(code);
	}
}
