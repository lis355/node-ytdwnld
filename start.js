import { config as dotenv } from "dotenv-flow";

import Application from "./components/app/Application.js";

dotenv();

const application = new Application();
await application.initialize();
await application.run();
