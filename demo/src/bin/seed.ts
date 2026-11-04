// npm run demo:seed [-- --run n]: fresh Alice + Bob at HF 1.30 (what Reset does).
import { connect, readDeployments, seedRun } from "../index";

const i = process.argv.indexOf("--run");
const n = i > 0 ? Number(process.argv[i + 1]) : undefined;
const ctx = await connect();
const d = await seedRun(ctx, readDeployments(), n);
console.log(`\nRun ${d.run!.n} ready. Next: npm run demo:crash -- --slow`);
process.exit(0);
