import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  unpackMint,
  unpackAccount,
  getExtensionTypes,
  getTransferFeeConfig,
  getScaledUiAmountConfig,
  getPausableConfig,
  getTransferHook,
  getMemoTransfer,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type Mint,
} from "@solana/spl-token";
import { b64, sha256 } from "../shared/crypto";
import { raw } from "../shared/amounts";
import {
  ata,
  ataAccountSize,
  buildTransactionBytes,
  maximumAtaRentLamports,
  validateTerms,
} from "../shared/transactions";
import type { Asset, Env, FrozenPlan, Holding, Terms } from "../shared/types";
import { decodeNonceAccount, nonceAddress } from "../shared/nonce";
export function integer(value: unknown): string {
  if (typeof value === "string") return raw(value).toString();
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("RPC returned an unsafe numeric integer");
  return value.toString();
}
export class Rpc {
  constructor(
    private url: string,
    private db?: D1Database,
  ) {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol))
      throw new Error("Invalid RPC endpoint");
  }
  async call<T = any>(method: string, params: unknown[] = []): Promise<T> {
    if (this.db) {
      const host = new URL(this.url).host,
        now = Date.now();
      const spacing = method === "sendTransaction" ? 1100 : 125,
        provider = host + (method === "sendTransaction" ? ":send" : ":read");
      const slot = await this.db
        .prepare(
          "INSERT INTO rpc_slots(provider,next_at) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET next_at=MAX(rpc_slots.next_at,?)+? WHERE rpc_slots.next_at<=? RETURNING next_at",
        )
        .bind(provider, now + spacing, now, spacing, now + 2000)
        .first<{ next_at: number }>();
      if (!slot)
        throw new Error(
          "RPC request budget is busy; retry original status shortly",
        );
      const wait = slot.next_at - spacing - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        `RPC ${method} transport unavailable; outcome may be unknown`,
      );
    }
    if (!response.ok)
      throw new Error(`RPC ${method} unavailable (${response.status})`);
    const result = (await response.json()) as {
      result: T;
      error?: { code: number };
    };
    if (result.error)
      throw new Error(
        `RPC ${method} rejected (${result.error.code}); this is not onchain failure evidence`,
      );
    return result.result;
  }
}
export function rpcFor(env: Env): Rpc {
  if (!env.SOLANA_RPC_URL)
    throw new Error("Configure the server-only Helius devnet RPC endpoint");
  return new Rpc(env.SOLANA_RPC_URL, env.DB);
}
export function registry(env: Env): Asset[] {
  if (env.SOLANA_CLUSTER !== "devnet")
    throw new Error(
      "Mainnet settlement is disabled pending eligibility and separate mint validation",
    );
  const data = JSON.parse(env.DEVNET_ASSETS_JSON || "[]") as Asset[];
  if (!Array.isArray(data) || data.length > 3)
    throw new Error(
      "Launch registry requires at most three separately validated devnet assets",
    );
  for (const a of data) {
    new PublicKey(a.mint);
    if (a.cluster !== "devnet" || !a.mock || !a.tested)
      throw new Error("Only explicitly tested devnet mock assets are enabled");
    if (
      ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
        a.tokenProgram,
      )
    )
      throw new Error("Unsupported mint program");
  }
  if (new Set(data.map((a) => a.mint)).size !== data.length)
    throw new Error("Duplicate registry mint");
  return data;
}
type RawInfo = {
  data: [string, string];
  owner: string;
  lamports: number;
  executable: boolean;
  rentEpoch: number;
};
function accountInfo(info: RawInfo | null): AccountInfo<Buffer> | null {
  if (!info) return null;
  if (info.data[1] !== "base64")
    throw new Error("Raw base64 RPC data required");
  return {
    ...info,
    data: Buffer.from(info.data[0], "base64"),
    owner: new PublicKey(info.owner),
  };
}
const permittedMintExtensions = new Set([
  ExtensionType.TransferFeeConfig,
  ExtensionType.MintCloseAuthority,
  ExtensionType.PermanentDelegate,
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
  ExtensionType.TransferHook,
  ExtensionType.ScaledUiAmountConfig,
  ExtensionType.PausableConfig,
]);
export function decodeAsset(
  entry: Asset,
  info: RawInfo | null,
  epoch: string,
  slot: string,
): { asset: Asset; mint: Mint } {
  const mint = unpackMint(
    new PublicKey(entry.mint),
    accountInfo(info),
    new PublicKey(entry.tokenProgram),
  );
  if (!mint.isInitialized || mint.decimals !== entry.decimals)
    throw new Error("Mint decimals or initialization changed");
  const extensions = getExtensionTypes(mint.tlvData);
  if (
    extensions.some((e) => !permittedMintExtensions.has(e)) ||
    JSON.stringify([...extensions].sort()) !==
      JSON.stringify([...entry.extensions].sort())
  )
    throw new Error("Mint has untested extensions");
  const scaled = getScaledUiAmountConfig(mint);
  if (scaled && (scaled.multiplier !== 1 || scaled.newMultiplier !== 1))
    throw new Error("Scaled UI multiplier is not the tested value 1");
  if (getPausableConfig(mint)?.paused) throw new Error("Mint is paused");
  const hook = getTransferHook(mint);
  if (hook && !hook.programId.equals(PublicKey.default))
    throw new Error("Active transfer hooks are unsupported");
  const fee = getTransferFeeConfig(mint);
  if (Boolean(fee) !== entry.hasTransferFee)
    throw new Error("Mint fee extension changed");
  const schedule = (f: {
    epoch: bigint;
    transferFeeBasisPoints: number;
    maximumFee: bigint;
  }) => ({
    epoch: f.epoch.toString(),
    basisPoints: f.transferFeeBasisPoints,
    maximumFeeRaw: f.maximumFee.toString(),
  });
  return {
    mint,
    asset: {
      ...entry,
      hasTransferFee: !!fee,
      olderFee: fee
        ? schedule(fee.olderTransferFee)
        : { epoch: "0", basisPoints: 0, maximumFeeRaw: "0" },
      newerFee: fee
        ? schedule(fee.newerTransferFee)
        : { epoch: "0", basisPoints: 0, maximumFeeRaw: "0" },
      observedEpoch: epoch,
      observedSlot: slot,
      observedAt: Date.now(),
      multiplier: "1",
      pendingMultiplier: "1",
    },
  };
}
async function mintSnapshot(env: Env) {
  const entries = registry(env);
  if (!entries.length)
    return { assets: [] as Asset[], mints: [] as Mint[], slot: "0" };
  const rpc = rpcFor(env);
  const epoch = await rpc.call("getEpochInfo", [{ commitment: "confirmed" }]);
  const result = await rpc.call("getMultipleAccounts", [
    entries.map((a) => a.mint),
    {
      encoding: "base64",
      commitment: "confirmed",
      minContextSlot: epoch.absoluteSlot,
    },
  ]);
  const slot = integer(result.context.slot);
  const decoded = entries.map((e, i) =>
    decodeAsset(e, result.value[i], integer(epoch.epoch), slot),
  );
  return {
    assets: decoded.map((d) => d.asset),
    mints: decoded.map((d) => d.mint),
    slot,
  };
}
export async function getAssets(env: Env): Promise<Asset[]> {
  return (await mintSnapshot(env)).assets;
}
export async function getPublicAssets(env: Env): Promise<Asset[]> {
  const identity = await sha256(env.DEVNET_ASSETS_JSON || "[]");
  const cached = await env.DB.prepare(
    "SELECT payload_json,checked_at FROM asset_cache WHERE cluster=? AND registry_hash=?",
  )
    .bind(env.SOLANA_CLUSTER, identity)
    .first<{ payload_json: string; checked_at: number }>();
  if (cached && Date.now() - cached.checked_at < 15000)
    return JSON.parse(cached.payload_json) as Asset[];
  const assets = await getAssets(env);
  await env.DB.prepare(
    "INSERT INTO asset_cache(cluster,registry_hash,payload_json,checked_at) VALUES(?,?,?,?) ON CONFLICT(cluster) DO UPDATE SET registry_hash=excluded.registry_hash,payload_json=excluded.payload_json,checked_at=excluded.checked_at",
  )
    .bind(env.SOLANA_CLUSTER, identity, JSON.stringify(assets), Date.now())
    .run();
  return assets;
}
export function validateTokenAccount(
  asset: Asset,
  owner: string,
  address: string,
  info: RawInfo | null,
) {
  const account = unpackAccount(
    new PublicKey(address),
    accountInfo(info),
    new PublicKey(asset.tokenProgram),
  );
  if (
    !account.mint.equals(new PublicKey(asset.mint)) ||
    !account.owner.equals(new PublicKey(owner)) ||
    account.isFrozen ||
    !account.isInitialized ||
    account.isNative ||
    account.delegate ||
    account.closeAuthority
  )
    throw new Error(
      "Unexpected token authority, state, delegate, close authority or mint",
    );
  const allowed = new Set([
    ExtensionType.TransferFeeAmount,
    ExtensionType.ImmutableOwner,
    ExtensionType.PausableAccount,
    ExtensionType.TransferHookAccount,
    ExtensionType.MemoTransfer,
  ]);
  if (
    getExtensionTypes(account.tlvData).some((e) => !allowed.has(e)) ||
    getMemoTransfer(account)?.requireIncomingTransferMemos
  )
    throw new Error("Unsupported token account transfer requirements");
  return account;
}
export async function getHoldings(
  env: Env,
  wallet: string,
): Promise<Holding[]> {
  new PublicKey(wallet);
  const { assets, slot } = await mintSnapshot(env);
  if (!assets.length) return [];
  const rpc = rpcFor(env),
    addresses = assets.map((a) => ata(wallet, a.mint, a.tokenProgram));
  const result = await rpc.call("getMultipleAccounts", [
    addresses,
    {
      encoding: "base64",
      commitment: "confirmed",
      minContextSlot: Number(slot),
    },
  ]);
  return assets.map((asset, i) => {
    try {
      const account = result.value[i]
        ? validateTokenAccount(asset, wallet, addresses[i], result.value[i])
        : null;
      return {
        asset,
        account: addresses[i],
        amountRaw: account?.amount.toString() ?? "0",
        supported: true,
        checkedAt: Date.now(),
      };
    } catch (e) {
      return {
        asset,
        account: addresses[i],
        amountRaw: "0",
        supported: false,
        reason: (e as Error).message,
        checkedAt: Date.now(),
      };
    }
  });
}
export async function assertDevnet(env: Env): Promise<void> {
  if (env.SOLANA_CLUSTER !== "devnet" || env.SETTLEMENT_ENABLED !== "true")
    throw new Error(
      "Settlement disabled until devnet setup and compatibility gates pass",
    );
  const genesis = await rpcFor(env).call<string>("getGenesisHash");
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
    throw new Error("RPC is not Solana devnet");
}
export async function readSigningNonce(
  rpc: Rpc,
  wallet: string,
  commitment: "confirmed" | "finalized" = "confirmed",
  minContextSlot?: number,
) {
  const address = await nonceAddress(wallet);
  const result = await rpc.call("getAccountInfo", [
    address,
    {
      encoding: "base64",
      commitment,
      ...(minContextSlot === undefined ? {} : { minContextSlot }),
    },
  ]);
  const slot = integer(result.context?.slot);
  if (minContextSlot !== undefined && BigInt(slot) < BigInt(minContextSlot))
    throw new Error("Signing account evidence is behind the required bank.");
  return { address, slot, account: decodeNonceAccount(result.value) };
}
export async function assertPlanLifetime(
  env: Env,
  plan: FrozenPlan,
): Promise<void> {
  await assertDevnet(env);
  const rpc = rpcFor(env);
  if (plan.terms.nonceAccount) {
    const nonce = await readSigningNonce(
      rpc,
      plan.terms.feePayer,
      "confirmed",
      Number(plan.contextSlot),
    );
    if (
      nonce.address !== plan.terms.nonceAccount ||
      !nonce.account ||
      nonce.account.authority !== plan.terms.feePayer ||
      nonce.account.value !== plan.blockhash
    )
      throw new Error(
        "This signing authorization was used or changed. Reconcile original status.",
      );
  } else if (
    BigInt(
      integer(await rpc.call("getBlockHeight", [{ commitment: "confirmed" }])),
    ) > BigInt(plan.lastValidBlockHeight)
  )
    throw new Error(
      "Signing lifetime passed. Reconcile original status before another attempt",
    );
}
export async function preparePlan(env: Env, terms: Terms): Promise<FrozenPlan> {
  await assertDevnet(env);
  if (terms.expiresAt <= Date.now()) throw new Error("Terms expired");
  const rpc = rpcFor(env),
    { assets, slot } = await mintSnapshot(env);
  validateTerms(terms, assets);
  const addresses = [
    ...new Set(terms.legs.flatMap((l) => [l.sourceAccount, l.destinationATA])),
  ];
  const state = await rpc.call("getMultipleAccounts", [
    addresses,
    {
      encoding: "base64",
      commitment: "confirmed",
      minContextSlot: Number(slot),
    },
  ]);
  const validationSlot = Math.max(
    Number(slot),
    Number(integer(state.context.slot)),
  );
  const byAddress = new Map<string, RawInfo | null>(
    addresses.map((a, i) => [a, state.value[i]]),
  );
  let rent = 0n;
  const sourceTotals = new Map<string, bigint>();
  for (const l of terms.legs)
    sourceTotals.set(
      l.sourceAccount,
      (sourceTotals.get(l.sourceAccount) ?? 0n) + raw(l.grossRaw),
    );
  const budgetedDestinations = new Set<string>();
  const quotedRentBySize = new Map<number, bigint>();
  for (const l of terms.legs) {
    const asset = assets.find((a) => a.mint === l.mint)!;
    const source = validateTokenAccount(
      asset,
      l.fromOwner,
      l.sourceAccount,
      byAddress.get(l.sourceAccount) ?? null,
    );
    if (source.amount < sourceTotals.get(l.sourceAccount)!)
      throw new Error(
        "Insufficient stock-token balance in the selected source ATA",
      );
    const dest = byAddress.get(l.destinationATA);
    if (dest) validateTokenAccount(asset, l.toOwner, l.destinationATA, dest);
    if (!budgetedDestinations.has(l.destinationATA)) {
      budgetedDestinations.add(l.destinationATA);
      // Every receiving ATA has an encoded idempotent create instruction. Even
      // an existing empty ATA can close before execution, so budget every one.
      const size = ataAccountSize(asset);
      const maximumRent = BigInt(maximumAtaRentLamports(asset));
      let quotedRent = quotedRentBySize.get(size);
      if (quotedRent === undefined) {
        quotedRent = BigInt(
          integer(
            await rpc.call("getMinimumBalanceForRentExemption", [
              size,
              { commitment: "confirmed" },
            ]),
          ),
        );
        quotedRentBySize.set(size, quotedRent);
      }
      if (quotedRent > maximumRent)
        throw new Error(
          "Current ATA rent exceeds the browser-verified policy bound; settlement is paused",
        );
      rent += maximumRent;
    }
  }
  // A finalized nonce read also provides the lower bound for future history
  // recovery. Never freeze a nonce that was only observed on an unrooted fork.
  const nonce = terms.nonceAccount
    ? await readSigningNonce(rpc, terms.feePayer, "finalized")
    : null;
  if (
    nonce &&
    (nonce.address !== terms.nonceAccount ||
      !nonce.account ||
      nonce.account.authority !== terms.feePayer)
  )
    throw new Error(
      "The fee payer must finish the one-time signing setup first.",
    );
  const latest = nonce
    ? {
        value: { blockhash: nonce.account!.value, lastValidBlockHeight: "0" },
        context: { slot: nonce.slot },
      }
    : await rpc.call("getLatestBlockhash", [
        { commitment: "confirmed", minContextSlot: validationSlot },
      ]);
  const plan: FrozenPlan = {
    terms,
    assets,
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: integer(latest.value.lastValidBlockHeight),
    contextSlot: integer(latest.context.slot),
    computeUnitLimit: 300000,
    microLamports: "0",
    createAtas: [...new Set(terms.legs.map((l) => l.destinationATA))],
    networkFeeLamports: (terms.owners.length * 5000).toString(),
    accountRentLamports: rent.toString(),
  };
  const candidate = buildTransactionBytes(plan);
  const simulation = await rpc.call("simulateTransaction", [
    b64(candidate.wire),
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
      minContextSlot: Math.max(validationSlot, Number(plan.contextSlot)),
    },
  ]);
  if (simulation.value.err)
    throw new Error(
      "Candidate simulation failed; refresh inventory and accepted terms",
    );
  const consumed = Number(simulation.value.unitsConsumed);
  if (!Number.isSafeInteger(consumed) || consumed <= 0 || consumed > 350000)
    throw new Error("Unexpected simulation compute usage");
  plan.computeUnitLimit = Math.min(
    400000,
    Math.max(30000, Math.ceil(consumed * 1.2) + 10000),
  );
  const fresh = nonce
    ? latest
    : await rpc.call("getLatestBlockhash", [
        { commitment: "confirmed", minContextSlot: Number(plan.contextSlot) },
      ]);
  plan.blockhash = fresh.value.blockhash;
  plan.lastValidBlockHeight = integer(fresh.value.lastValidBlockHeight);
  plan.contextSlot = integer(fresh.context.slot);
  const fee = await rpc.call("getFeeForMessage", [
    b64(buildTransactionBytes(plan).message),
    { commitment: "confirmed" },
  ]);
  if (fee.value === null)
    throw new Error("Cannot price network fee for this message");
  plan.networkFeeLamports = integer(fee.value);
  buildTransactionBytes(plan);
  const balance = await rpc.call("getBalance", [
    terms.feePayer,
    { commitment: "confirmed", minContextSlot: Number(plan.contextSlot) },
  ]);
  if (BigInt(integer(balance.value)) < raw(plan.networkFeeLamports) + rent)
    throw new Error(
      "Fee payer has insufficient devnet SOL for network fee and receiving accounts",
    );
  return plan;
}
