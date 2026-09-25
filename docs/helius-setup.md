# Add your free Helius devnet endpoint

This is the one private provider setting needed for the next live test. It is an API credential, not a wallet or recovery phrase. Keep it in the local file; do not paste it into chat.

1. Open [the Helius dashboard](https://dashboard.helius.dev/) and sign up or sign in. Choose the **Free** dashboard plan. No credit purchase, Agent signup payment or paid add-on is needed. If the page asks you to pay, stop that signup path.
2. Open **Get started**, the current starting tab named in [Helius's official quickstart](https://www.helius.dev/docs/quickstart). Find your API key or RPC endpoint in the dashboard's key/endpoint area. Dashboard labels can vary; this guide does not claim to have accessed your private account.
3. Use the **devnet** endpoint. It has this exact shape, documented by [Helius's devnet guide](https://demo.helius.dev/sandbox):

   ```text
   https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
   ```

   If you copied a complete URL beginning with `https://mainnet.helius-rpc.com/`, change the host to `devnet.helius-rpc.com`, retaining your key. If you copied only the key, insert it after `api-key=`. Do not use a WebSocket (`wss://`), Sender or mainnet endpoint.
4. In the project folder, open **`.dev.vars`** in your editor. It is a hidden filename beginning with a dot. The setup has an ignored template; if it does not exist, copy `.env.example` to `.dev.vars`. Replace the whole `SOLANA_RPC_URL=` line with your complete devnet URL. Keep all other settings in place, especially:

   ```dotenv
   SOLANA_CLUSTER=devnet
   SETTLEMENT_ENABLED=false
   ```

   Keep the URL on one line. Save the file. Never rename this setting to start with `VITE_`; those frontend variables can expose credentials.
5. Tell the developer **“Helius saved locally”**, without the URL or key. Restart the local Worker if it was already running so it reloads the file. `/api/health` showing `rpcConfigured: true` only confirms a value is present; the actual devnet genesis/connection check must still pass before fixtures run.

The app server will call Helius. Browser wallets do not need your Helius key. For hosting, the same value is entered through `npx wrangler secret put SOLANA_RPC_URL` with the reviewed deployment config; it is not committed to GitHub. See [deployment](deployment.md) for that later step.

Free limits currently include one million monthly credits, 10 RPC requests/second and one transaction submission/second. The dashboard Free plan differs from the paid programmatic Agent signup. [Current limits and sources](release/provider-limits.md).
