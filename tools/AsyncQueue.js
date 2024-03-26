export default class AsyncQueue {
	constructor() {
		this.clear();

		this.process = this.process.bind(this);
	}

	clear() {
		this.queue = [];
	}

	push(asyncFunction) {
		return new Promise((resolve, reject) => {
			this.queue.push({ asyncFunction, resolve, reject });

			setImmediate(this.process);
		});
	}

	async process() {
		if (this.processing ||
			this.queue.length === 0) return;

		this.processing = true;

		const { asyncFunction, resolve, reject } = this.queue.shift();

		try {
			resolve(await asyncFunction());
		} catch (error) {
			reject(error);
		}

		this.processing = false;

		setImmediate(this.process);
	}
}
