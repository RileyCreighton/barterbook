# Add a free Alchemy devnet backup

Alchemy passed [11 read-only checks](../evidence/devnet/20260925-sdk-proof-01/recovery-provider-checks/alchemy-1790325426672-5f5fe58c-7548-4e4b-8ad3-ef0ec142d7a1.json) and is now configured as the server-only devnet backup. Both healthy, trusted providers supported [safe expiry reconciliation](../evidence/devnet/20260925-sdk-proof-01/hosted-original-reconciliation-1790325517997.json) of the original hosted SDK attempt; its journal is preserved. The steps below remain a setup reference. Do not repeat them or overwrite the saved URL.

The Free plan currently includes **30 million compute units/month and 25 requests/second**; compute units are provider billing units, not one unit per request. [Official pricing](https://www.alchemy.com/pricing). No paid upgrade was made. The earlier public Solana fallback returned 403 at `getHealth`, and the tested dRPC route required paid access; those historical failures were provider access, not CPU/query-cap failures.

## Create the endpoint

1. Open [Alchemy's dashboard](https://dashboard.alchemy.com/) in your normal account browser and sign up or sign in. Choose **Free**. Stop if the flow requires a paid upgrade.
2. Open your team menu → **Team Overview → Apps → Create new app**. Name it **BarterBook Devnet Backup**, enable **Solana** and its RPC service, and choose **Create App**. If signup already created a suitable Solana app, you can use it. These labels follow [Alchemy's official app/key guide](https://www.alchemy.com/docs/create-an-api-key).
3. Open the app's **Endpoints** tab. Select **Solana Devnet**, then copy its **HTTP** URL. Do not select Solana Mainnet or a WebSocket URL. Alchemy documents this format:

   ```text
   https://solana-devnet.g.alchemy.com/v2/YOUR_API_KEY
   ```

   [Official Solana Devnet endpoint](https://www.alchemy.com/rpc/solana-devnet). The full URL contains a private credential; do not paste it into chat.

## Save it privately from Fish or Bash

Paste this whole command into the terminal. It explicitly launches Bash, so it also works when your normal shell is Fish. At the prompt, paste the URL and press Enter. The input stays hidden and is not placed in shell history.

```sh
bash -c '
cd /home/riley/dev/barterbook || exit 1
umask 077
set -o noclobber
read -r -s -p "Paste the Alchemy Solana Devnet HTTP URL: " rpc_backup_url || exit 1
printf "\n"
if [[ ! "$rpc_backup_url" =~ ^https://solana-devnet\.g\.alchemy\.com/v2/[A-Za-z0-9_-]+$ ]]; then
  printf "Expected the complete Alchemy Solana Devnet HTTP URL; nothing saved.\n" >&2
  exit 1
fi
printf "SOLANA_RPC_FALLBACK_URL=%s\n" "$rpc_backup_url" > .env.rpc-backup.local || exit 1
unset rpc_backup_url
printf "Backup URL saved privately. Tell the developer: Alchemy saved locally.\n"
'
```

The ignored file is `.env.rpc-backup.local`, created with owner-only permissions. The command refuses to overwrite an existing file; if it already exists, report that without showing its contents. Never commit the file or prefix this setting with `VITE_`.

Tell the developer **“Alchemy saved locally”** only. Saving is not activation or verification. The developer must check devnet identity, health, retained history and original transaction status from the Worker, then install the URL as the server-only fallback secret and record the assessment. Alchemy must pass those checks before its absence result can support recovery. No new signature or replacement is authorized merely by creating this account.
