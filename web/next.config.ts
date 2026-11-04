// Server-side env: the operator routes need OPERATOR_PRIVATE_KEY, DEMO_MNEMONIC and RPC_URL from the root `.env`
// (gitignored). Only NEXT_PUBLIC_* vars reach the browser, and none of these are.
import { resolve } from "node:path";
import type { NextConfig } from "next";

const root = resolve(process.cwd(), "..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  // no root .env: use the shell environment
}
process.env.REPO_ROOT ??= root;

const config: NextConfig = {
  transpilePackages: ["@liquidation-shield/shared", "@liquidation-shield/demo"],
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
