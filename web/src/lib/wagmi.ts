// wagmi for the product page (/): an injected wallet on Monad testnet. Reads go through the server's /api/rpc
// proxy (no provider key in the browser); writes are signed and sent by the user's own wallet.
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { testnetChain } from "@liquidation-shield/shared";

export const wagmiConfig = createConfig({
  chains: [testnetChain],
  connectors: [injected()],
  transports: { [testnetChain.id]: http("/api/rpc", { retryCount: 4, retryDelay: 300 }) },
  ssr: true,
  pollingInterval: 1_000,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
