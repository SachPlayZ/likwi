// npm run demo:deploy: run once before demo day. Needs a faucet-funded OPERATOR_PRIVATE_KEY.
import { connect, deployAll } from "../index";

const ctx = await connect();
const d = await deployAll(ctx);
console.log(`\nShield ${d.shield}\nWrote demo/.deployments.json and web/.env.local. Next: npm run demo:seed`);
process.exit(0);
