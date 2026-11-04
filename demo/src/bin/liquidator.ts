// npm run demo:liquidator: liquidates the current run's Alice whenever her HF < 1. Ctrl-C to stop.
import { connect, runLiquidator } from "../index";

const stop = await runLiquidator(await connect());
process.on("SIGINT", () => (stop(), process.exit(0)));
process.on("SIGTERM", () => (stop(), process.exit(0)));
