// npm run demo:crash -- --pct 15 | --slow
import { connect, crash, readDeployments, slowCrash } from "../index";

const args = process.argv.slice(2);
const i = args.indexOf("--pct");
const ctx = await connect();
const d = readDeployments();
if (args.includes("--slow")) await slowCrash(ctx, d);
else if (i >= 0) await crash(ctx, d, BigInt(args[i + 1]!));
else throw new Error("Usage: npm run demo:crash -- --pct 15 | --slow");
process.exit(0);
