/** Hosted application rehearsal using only the run's disposable SDK keys. NOT browser-wallet proof. */
import { Keypair, Transaction } from "@solana/web3.js";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { b64, canonical, sha256, unb64 } from "../src/shared/crypto";
import {
  hashTerms,
  legFor,
  mergeSignature,
  transactionId,
  unsignedWire,
  validateTerms,
  verifyTransaction,
  verifyWireSignatures,
  wireParts,
} from "../src/shared/transactions";
import {
  receiptFromMetadata,
  type TransactionEvidence,
} from "../src/shared/receipt";
import type {
  Asset,
  Attempt,
  FrozenPlan,
  Room,
  Terms,
} from "../src/shared/types";
import {
  authenticateSdkWallet,
  type ApiSession,
  type Http,
  type SeedPlan,
} from "./devnet-board-seed";
import {
  args,
  fixtureKey,
  immutableJson,
  openRun,
  pause,
  publicEvidence,
  readJson,
  recordEvent,
  safeName,
  validateJournal,
  type Journal,
  type Run,
} from "./devnet-common";

export interface HostedContext {
  run: Run;
  batch: string;
  origin: string;
  root: string;
  seed: SeedPlan;
  seedResult: { listingIds: string[]; roomId: string };
  assets: Asset[];
  wallets: Map<string, Keypair>;
  sessions: Map<string, ApiSession>;
  pollLimit?: number;
  sleep?: (ms: number) => Promise<void>;
}
interface FrozenHostedAttempt {
  id: string;
  roomId: string;
  termsHash: string;
  plan: FrozenPlan;
  messageBase64: string;
  messageHash: string;
  createdAt: number;
  unsignedWireBase64: string;
}
interface HostedPublicEvidence {
  cluster: string;
  termsHash: string;
  messageBase64: string;
  messageHash: string;
  fullWireBase64: string;
  transaction: TransactionEvidence;
  buildId: string | null;
}
export function assertHostedRegistry(
  health: {
    cluster: string;
    settlementEnabled: boolean;
    rpcConfigured: boolean;
  },
  assets: Asset[],
  expected: Asset[],
): void {
  if (
    health.cluster !== "devnet" ||
    health.settlementEnabled !== true ||
    health.rpcConfigured !== true
  )
    throw new Error(
      "Hosted rehearsal requires an enabled devnet deployment with server RPC configured",
    );
  if (
    assets.length !== 3 ||
    expected.length !== 3 ||
    new Set(assets.map((asset) => asset.mint)).size !== 3 ||
    assets.some(
      (asset) => asset.cluster !== "devnet" || !asset.mock || !asset.tested,
    ) ||
    expected.some(
      (asset) =>
        !assets.some(
          (current) =>
            current.mint === asset.mint &&
            current.tokenProgram === asset.tokenProgram &&
            current.decimals === asset.decimals,
        ),
    )
  )
    throw new Error(
      "Hosted registry must match this run's three separately validated mock devnet mints",
    );
}
function normalizedTerms(terms: Terms) {
  return {
    ...terms,
    owners: [...terms.owners].sort(),
    legs: [...terms.legs].sort((a, b) =>
      canonical(a).localeCompare(canonical(b)),
    ),
    minima: [...terms.minima].sort((a, b) =>
      canonical(a).localeCompare(canonical(b)),
    ),
  };
}
export function expectedRingTerms(seed: SeedPlan, assets: Asset[]): Terms {
  const legs = seed.listings.map((listing) => {
    const recipients = seed.listings.filter(
      (candidate) => candidate.body.wantMint === listing.body.giveMint,
    );
    if (recipients.length !== 1)
      throw new Error(
        "Seed listings do not define one exact three-owner cycle",
      );
    const asset = assets.find(
      (candidate) => candidate.mint === listing.body.giveMint,
    );
    if (!asset) throw new Error("Seed asset is not in the hosted registry");
    return legFor(
      listing.owner,
      recipients[0].owner,
      asset,
      listing.body.grossRaw,
    );
  });
  const terms: Terms = {
    cluster: "devnet",
    version: 1,
    mode: "RING",
    owners: seed.wallets,
    feePayer: seed.wallets[0],
    maxNetworkFeeLamports: seed.offer.body.terms.maxNetworkFeeLamports,
    maxAccountRentLamports: seed.offer.body.terms.maxAccountRentLamports,
    expiresAt: Math.min(
      ...seed.listings.map((listing) => listing.body.expiresAt),
    ),
    legs,
    minima: seed.listings.map((listing) => ({
      owner: listing.owner,
      mint: listing.body.wantMint,
      minNetRaw: listing.body.minReceiveNetRaw,
    })),
  };
  validateTerms(terms, assets);
  return terms;
}
async function assertRoom(
  room: Room,
  expected: Terms,
  assets: Asset[],
): Promise<void> {
  validateTerms(room.terms, assets);
  if (
    canonical(normalizedTerms(room.terms)) !==
      canonical(normalizedTerms(expected)) ||
    (await hashTerms(room.terms)) !== room.termsHash
  )
    throw new Error(
      "Hosted room differs from the exact accepted rehearsal terms",
    );
}
function api(
  context: HostedContext,
  wallet = context.seed.wallets[0],
): ApiSession {
  const session = context.sessions.get(wallet);
  if (!session)
    throw new Error(
      "No authenticated disposable SDK participant for this room",
    );
  return session;
}
function startMarker(path: string, identity: object): void {
  immutableJson(
    path,
    {
      ...identity,
      requestId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    },
    true,
  );
}
function flowRoot(context: HostedContext, mode: "basket" | "ring") {
  return join(context.root, mode);
}
export async function getOrCreateRingRoom(
  context: HostedContext,
): Promise<Room> {
  const expected = expectedRingTerms(context.seed, context.assets),
    directory = flowRoot(context, "ring"),
    recorded = join(directory, "room.json");
  if (existsSync(recorded)) {
    const saved = readJson<{ id: string }>(recorded);
    const { room } = await api(context)<{ room: Room }>(`/rooms/${saved.id}`);
    await assertRoom(room, expected, context.assets);
    return room;
  }
  const { rooms } = await api(context)<{ rooms: Room[] }>("/rooms");
  const candidates = rooms.filter(
    (room) =>
      room.terms.mode === "RING" &&
      canonical([...room.listingIds].sort()) ===
        canonical([...context.seedResult.listingIds].sort()),
  );
  if (candidates.length > 1)
    throw new Error(
      "Multiple rooms match the original ring request; inspect them without creating another",
    );
  let room = candidates[0];
  if (!room) {
    if (!context.run.execute)
      throw new Error(
        "--resume cannot create a fresh ring room; original creation is not recorded",
      );
    const marker = join(directory, "room-create-started.json");
    if (existsSync(marker))
      throw new Error(
        "Original ring room creation is unresolved. Reconcile /rooms; no duplicate room request was sent",
      );
    const body = {
      listingIds: context.seedResult.listingIds,
      feePayer: expected.feePayer,
      maxNetworkFeeLamports: expected.maxNetworkFeeLamports,
      maxAccountRentLamports: expected.maxAccountRentLamports,
    };
    startMarker(marker, { origin: context.origin, body });
    room = (await api(context)<{ room: Room }>("/matches/room", body)).room;
  }
  await assertRoom(room, expected, context.assets);
  immutableJson(
    recorded,
    {
      id: room.id,
      terms: room.terms,
      termsHash: room.termsHash,
      listingIds: room.listingIds,
    },
    true,
  );
  return room;
}
async function freezeAttempt(
  context: HostedContext,
  directory: string,
  attempt: Attempt,
  terms: Terms,
): Promise<FrozenHostedAttempt> {
  verifyTransaction(unb64(attempt.wireBase64), attempt.plan, terms);
  if (
    attempt.termsHash !== (await hashTerms(terms)) ||
    attempt.messageBase64 !==
      b64(wireParts(unb64(attempt.wireBase64)).message) ||
    attempt.messageHash !== (await sha256(unb64(attempt.messageBase64)))
  )
    throw new Error(
      "Hosted attempt message identity does not match accepted terms",
    );
  const frozen: FrozenHostedAttempt = {
    id: attempt.id,
    roomId: attempt.roomId,
    termsHash: attempt.termsHash,
    plan: attempt.plan,
    messageBase64: attempt.messageBase64,
    messageHash: attempt.messageHash,
    createdAt: attempt.createdAt,
    unsignedWireBase64: unsignedWire(attempt.plan),
  };
  immutableJson(join(directory, "attempt.json"), frozen, true);
  return frozen;
}
function checkFrozen(attempt: Attempt, frozen: FrozenHostedAttempt): void {
  if (
    attempt.id !== frozen.id ||
    attempt.roomId !== frozen.roomId ||
    attempt.termsHash !== frozen.termsHash ||
    attempt.messageBase64 !== frozen.messageBase64 ||
    attempt.messageHash !== frozen.messageHash ||
    canonical(attempt.plan) !== canonical(frozen.plan)
  )
    throw new Error(
      "Hosted attempt changed its frozen identity; no new signatures permitted",
    );
  verifyTransaction(unb64(attempt.wireBase64), frozen.plan, frozen.plan.terms);
}
async function saveFullWire(
  context: HostedContext,
  directory: string,
  frozen: FrozenHostedAttempt,
  wireBase64: string,
): Promise<Journal> {
  const wire = unb64(wireBase64);
  verifyTransaction(wire, frozen.plan, frozen.plan.terms);
  await verifyWireSignatures(wire, frozen.plan, true);
  if (!Number.isSafeInteger(Number(frozen.plan.lastValidBlockHeight)))
    throw new Error(
      "Hosted lifetime cannot be represented safely by the SDK journal",
    );
  const journal: Journal = {
    schemaVersion: 1,
    runId: context.run.runId,
    buildId: context.run.buildId,
    name: `hosted-${context.batch}-${frozen.plan.terms.mode.toLowerCase()}`,
    cluster: "devnet",
    txid: transactionId(wire),
    wireBase64,
    messageBase64: frozen.messageBase64,
    blockhash: frozen.plan.blockhash,
    lastValidBlockHeight: Number(frozen.plan.lastValidBlockHeight),
    createdAt: new Date(frozen.createdAt).toISOString(),
    expectedFailure: false,
  };
  const path = join(directory, "full-signed.json");
  if (existsSync(path)) {
    const previous = readJson<Journal>(path);
    validateJournal(previous);
    if (
      previous.txid !== journal.txid ||
      previous.wireBase64 !== wireBase64 ||
      previous.messageBase64 !== frozen.messageBase64 ||
      previous.blockhash !== frozen.plan.blockhash ||
      String(previous.lastValidBlockHeight) !==
        frozen.plan.lastValidBlockHeight ||
      previous.runId !== context.run.runId
    )
      throw new Error(
        "Original full signed bytes differ; a replacement is forbidden",
      );
    return previous;
  }
  immutableJson(path, journal, true);
  return journal;
}
async function archiveFinalized(
  context: HostedContext,
  directory: string,
  attempt: Attempt,
  frozen: FrozenHostedAttempt,
): Promise<void> {
  checkFrozen(attempt, frozen);
  if (
    attempt.state !== "FINALIZED" ||
    !attempt.receipt?.verified ||
    !attempt.fullWireBase64 ||
    !attempt.txid
  )
    throw new Error(
      "Hosted transaction has not produced a verified finalized receipt",
    );
  const journal = await saveFullWire(
    context,
    directory,
    frozen,
    attempt.fullWireBase64,
  );
  if (attempt.txid !== journal.txid)
    throw new Error(
      "Hosted transaction identifier differs from the locally derived identifier",
    );
  const evidence = await api(context)<HostedPublicEvidence>(
    `/receipts/${journal.txid}/evidence`,
  );
  if (
    evidence.cluster !== "devnet" ||
    evidence.termsHash !== frozen.termsHash ||
    evidence.messageBase64 !== frozen.messageBase64 ||
    evidence.messageHash !== frozen.messageHash ||
    evidence.fullWireBase64 !== journal.wireBase64
  )
    throw new Error(
      "Public hosted evidence differs from the original signed transaction",
    );
  const verifiedReceipt = receiptFromMetadata(
    attempt,
    evidence.transaction,
    true,
  );
  if (canonical(verifiedReceipt) !== canonical(attempt.receipt))
    throw new Error(
      "Hosted receipt differs from locally verified transaction-specific metadata",
    );
  const parts = wireParts(unb64(journal.wireBase64));
  const signatures = frozen.plan.terms.owners.map((owner) => {
    const observation = readJson<{
      attemptId: string;
      owner: string;
      messageHash: string;
      signatureBase64: string;
    }>(join(directory, `signature-${owner}.json`));
    if (
      observation.attemptId !== frozen.id ||
      observation.owner !== owner ||
      observation.messageHash !== frozen.messageHash ||
      observation.signatureBase64 !==
        b64(parts.signatures[parts.signers.indexOf(owner)])
    )
      throw new Error(
        "SDK signing observation differs from the finalized message/signature",
      );
    return observation;
  });
  publicEvidence(
    context.run,
    `hosted-${context.batch}-${frozen.plan.terms.mode.toLowerCase()}-receipt.json`,
    {
      schemaVersion: 1,
      runId: context.run.runId,
      batch: context.batch,
      origin: context.origin,
      cluster: "devnet",
      signingMethod:
        "Disposable SDK keys through the hosted application API; NOT browser-wallet signing proof",
      localBuildId: journal.buildId,
      hostedBuildId: evidence.buildId,
      roomId: attempt.roomId,
      attemptId: attempt.id,
      txid: journal.txid,
      explorer: `https://explorer.solana.com/tx/${journal.txid}?cluster=devnet`,
      messageBase64: frozen.messageBase64,
      messageHash: frozen.messageHash,
      fullWireBase64: journal.wireBase64,
      preservedMessage: true,
      receipt: verifiedReceipt,
      rawApiEvidence: evidence,
      signatures,
    },
  );
}
export async function rehearseRoom(
  context: HostedContext,
  input: Room,
  expected: Terms,
): Promise<Attempt> {
  const mode = expected.mode === "BASKET" ? "basket" : "ring",
    directory = flowRoot(context, mode);
  await assertRoom(input, expected, context.assets);
  if (input.terms.owners.some((owner) => !context.wallets.has(owner)))
    throw new Error(
      "Only this run's authorized disposable SDK owners may be rehearsed",
    );
  immutableJson(
    join(directory, "room.json"),
    {
      id: input.id,
      terms: input.terms,
      termsHash: input.termsHash,
      listingIds: input.listingIds,
    },
    true,
  );
  let room = input;
  const frozenPath = join(directory, "attempt.json"),
    existingFrozen = existsSync(frozenPath)
      ? readJson<FrozenHostedAttempt>(frozenPath)
      : null;
  if (
    existingFrozen &&
    (!room.attempt || room.attempt.id !== existingFrozen.id)
  )
    throw new Error(
      "Original hosted attempt is missing or was replaced; inspect original status instead of preparing again",
    );
  if (!room.attempt) {
    if (!context.run.execute)
      throw new Error("--resume cannot prepare a fresh executable attempt");
    if (room.terms.expiresAt <= Date.now())
      throw new Error(
        "Rehearsal terms expired; do not silently replace the original seed batch",
      );
    for (const owner of room.terms.owners) {
      if (!context.wallets.has(owner))
        throw new Error(
          "Only the run's authorized disposable SDK owners may be rehearsed",
        );
      await api(context, owner)(`/rooms/${room.id}/accept`, {
        version: room.terms.version,
        termsHash: room.termsHash,
      });
      await api(context, owner)(`/rooms/${room.id}/ready`, {
        version: room.terms.version,
        ready: true,
      });
    }
    const marker = join(directory, "attempt-create-started.json");
    if (existsSync(marker))
      throw new Error(
        "Original prepare response is unresolved; reload the same room without creating another attempt",
      );
    startMarker(marker, {
      roomId: room.id,
      version: room.terms.version,
      termsHash: room.termsHash,
    });
    const prepared = await api(context)<{ attempt: Attempt }>(
      `/rooms/${room.id}/attempts`,
      { version: room.terms.version, termsHash: room.termsHash },
    );
    room = { ...room, attempt: prepared.attempt };
  }
  let attempt = room.attempt!;
  if (attempt.roomId !== room.id)
    throw new Error("Hosted attempt belongs to another room");
  const frozen = await freezeAttempt(context, directory, attempt, room.terms);
  if (attempt.state === "FINALIZED") {
    await archiveFinalized(context, directory, attempt, frozen);
    return attempt;
  }
  if (existingFrozen && !context.run.resume)
    throw new Error(
      "Original attempt is unfinished; use --resume to continue only its frozen message",
    );
  if (
    attempt.stopRequested ||
    attempt.safeToRetry ||
    ["FAILED_ONCHAIN", "EXPIRED_UNLANDED"].includes(attempt.state)
  )
    throw new Error(
      "Original attempt stopped or failed. This rehearsal never automatically renews terms or asks for replacement signatures",
    );
  if (attempt.state === "SIGNING") {
    const owners = [
      room.terms.feePayer,
      ...room.terms.owners.filter((owner) => owner !== room.terms.feePayer),
    ];
    for (const owner of owners) {
      attempt = (
        await api(
          context,
          owner,
        )<{ attempt: Attempt }>(`/attempts/${attempt.id}`)
      ).attempt;
      checkFrozen(attempt, frozen);
      if (attempt.signatures[owner]) continue;
      if (attempt.state !== "SIGNING" || attempt.stopRequested)
        throw new Error("Original attempt is no longer collecting signatures");
      const wallet = context.wallets.get(owner);
      if (!wallet)
        throw new Error("No authorized local SDK key for this owner");
      const fresh = await api(
        context,
        owner,
      )<{ assets: Asset[] }>("/assets/fresh");
      assertHostedRegistry(
        { cluster: "devnet", settlementEnabled: true, rpcConfigured: true },
        fresh.assets,
        context.assets,
      );
      validateTerms(room.terms, fresh.assets);
      const previous = unb64(attempt.wireBase64);
      verifyTransaction(previous, frozen.plan, room.terms);
      await verifyWireSignatures(previous, frozen.plan, false);
      const transaction = Transaction.from(previous);
      transaction.partialSign(wallet);
      const merged = await mergeSignature(
        previous,
        transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
        owner,
        frozen.plan,
      );
      const parts = wireParts(merged),
        messageHash = await sha256(parts.message);
      if (
        messageHash !== frozen.messageHash ||
        b64(parts.message) !== frozen.messageBase64
      )
        throw new Error("SDK signature changed the accepted message");
      const signerIndex = parts.signers.indexOf(owner);
      immutableJson(
        join(directory, `signature-${owner}.json`),
        {
          attemptId: frozen.id,
          owner,
          messageHash,
          signatureBase64: b64(parts.signatures[signerIndex]),
        },
        true,
      );
      if (parts.signatures.every((signature) => signature.some(Boolean)))
        await saveFullWire(context, directory, frozen, b64(merged));
      attempt = (
        await api(context, owner)<{ attempt: Attempt }>(
          `/attempts/${attempt.id}/signatures`,
          { wireBase64: b64(merged) },
        )
      ).attempt;
      checkFrozen(attempt, frozen);
    }
  }
  if (attempt.fullWireBase64)
    await saveFullWire(context, directory, frozen, attempt.fullWireBase64);
  // A timeout resumes the same attempt. Never derive another lifetime or create another attempt.
  if (
    existsSync(join(directory, "submit-started.json")) ||
    attempt.submissionStartedAt !== null ||
    !["SIGNING", "FULLY_SIGNED"].includes(attempt.state)
  ) {
    attempt = (
      await api(context)<{ attempt: Attempt }>(
        `/attempts/${attempt.id}/reconcile`,
        {},
      )
    ).attempt;
    checkFrozen(attempt, frozen);
  }
  if (
    attempt.state === "FULLY_SIGNED" &&
    attempt.submissionStartedAt === null &&
    !attempt.stopRequested
  ) {
    if (!attempt.fullWireBase64)
      throw new Error("Original full signed bytes are missing");
    const full = await saveFullWire(
      context,
      directory,
      frozen,
      attempt.fullWireBase64,
    );
    const marker = join(directory, "submit-started.json");
    if (!existsSync(marker))
      startMarker(marker, {
        attemptId: attempt.id,
        txid: full.txid,
        messageHash: frozen.messageHash,
        lastValidBlockHeight: full.lastValidBlockHeight,
      });
    attempt = (
      await api(context)<{ attempt: Attempt }>(
        `/attempts/${attempt.id}/submit`,
        {},
      )
    ).attempt;
    checkFrozen(attempt, frozen);
  }
  for (let poll = 0; poll < (context.pollLimit ?? 12); poll++) {
    if (attempt.state === "FINALIZED") {
      await archiveFinalized(context, directory, attempt, frozen);
      return attempt;
    }
    if (
      attempt.safeToRetry ||
      attempt.stopRequested ||
      ["FAILED_ONCHAIN", "EXPIRED_UNLANDED"].includes(attempt.state)
    )
      throw new Error(
        "Original hosted outcome is terminal or stopped; no replacement is permitted by this rehearsal",
      );
    await (context.sleep ?? pause)(3000);
    attempt = (
      await api(context)<{ attempt: Attempt }>(
        `/attempts/${attempt.id}/reconcile`,
        {},
      )
    ).attempt;
    checkFrozen(attempt, frozen);
  }
  if (attempt.state === "FINALIZED") {
    await archiveFinalized(context, directory, attempt, frozen);
    return attempt;
  }
  throw new Error(
    `Original attempt ${attempt.id} is still ${attempt.state}. Resume the same run/batch; do not delete its journals or create replacement signatures`,
  );
}
export async function runHostedRehearsal(
  context: HostedContext,
): Promise<Attempt[]> {
  const { room: basket } = await api(context)<{ room: Room }>(
    `/rooms/${context.seedResult.roomId}`,
  );
  const first = await rehearseRoom(
    context,
    basket,
    context.seed.offer.body.terms,
  );
  const ring = await getOrCreateRingRoom(context);
  const second = await rehearseRoom(
    context,
    ring,
    expectedRingTerms(context.seed, context.assets),
  );
  return [first, second];
}
export function profiledTransport(
  run: Run,
  batch: string,
  transport: Http = fetch,
): Http {
  return (async (input, init) => {
    const startedAt = new Date().toISOString(),
      start = performance.now();
    let status: number | null = null;
    try {
      const response = await transport(input, init);
      status = response.status;
      return response;
    } finally {
      recordEvent(join(run.evidenceRoot, `hosted-${batch}-requests`), {
        startedAt,
        method: init?.method ?? "GET",
        path: new URL(String(input)).pathname,
        httpStatus: status,
        wallTimeMs: performance.now() - start,
        measurement:
          "Client wall-clock latency, NOT Worker CPU; correlate with Cloudflare request CPU telemetry",
      });
    }
  }) as Http;
}
export async function main(): Promise<void> {
  const options = args(),
    run = openRun(options),
    batch = safeName(options.get("--batch") ?? "hosted-01"),
    seedBatch = safeName(options.get("--seed-batch") ?? "hosted-judge-01");
  const seed = readJson<SeedPlan>(
    join(run.privateRoot, "board", `${seedBatch}-intent.json`),
  );
  const seedResult = readJson<{
    origin: string;
    listingIds: string[];
    roomId: string;
  }>(join(run.evidenceRoot, `board-${seedBatch}.json`));
  const origin = new URL(options.get("--url") ?? seed.origin).origin;
  const root = join(run.privateRoot, "hosted", batch),
    assets = readJson<Asset[]>(join(run.evidenceRoot, "assets.json"));
  if (
    origin !== seed.origin ||
    seedResult.origin !== origin ||
    seed.runId !== run.runId ||
    seedResult.listingIds.length !== 3
  )
    throw new Error(
      "Hosted origin/run/listings differ from the durable seed batch",
    );
  const wallets = new Map(
    [0, 1, 2].map((i) => {
      const key = fixtureKey(run, `wallet-${i}`);
      return [key.publicKey.toBase58(), key] as const;
    }),
  );
  if (
    seed.wallets.length !== 3 ||
    seed.wallets.some((wallet) => !wallets.has(wallet))
  )
    throw new Error("Seed wallets differ from this run's disposable SDK keys");
  immutableJson(
    join(root, "manifest.json"),
    {
      schemaVersion: 1,
      runId: run.runId,
      batch,
      seedBatch,
      origin,
      sdkOwners: seed.wallets,
      listingIds: seedResult.listingIds,
      basketRoomId: seedResult.roomId,
      scope: "Hosted SDK rehearsal, not browser-wallet proof",
    },
    true,
  );
  if (!run.execute && !run.resume) {
    console.log(
      `Prepared immutable hosted rehearsal ${batch} for existing seed ${seedBatch}. No HTTP mutation or transaction sent. Use --execute once or --execute --resume to continue original attempts.`,
    );
    return;
  }
  const transport = profiledTransport(run, batch);
  const healthResponse = await transport(`${origin}/api/health`, {
    redirect: "error",
  });
  const registryResponse = await transport(`${origin}/api/assets`, {
    redirect: "error",
  });
  if (!healthResponse.ok || !registryResponse.ok)
    throw new Error("Hosted devnet health/registry is unavailable");
  const health = (await healthResponse.json()) as {
      cluster: string;
      settlementEnabled: boolean;
      rpcConfigured: boolean;
    },
    registry = (await registryResponse.json()) as { assets: Asset[] };
  assertHostedRegistry(health, registry.assets, assets);
  const sessions = new Map<string, ApiSession>();
  for (const [owner, wallet] of wallets)
    sessions.set(owner, await authenticateSdkWallet(origin, wallet, transport));
  const results = await runHostedRehearsal({
    run,
    batch,
    origin,
    root,
    seed,
    seedResult,
    assets: registry.assets,
    wallets,
    sessions,
  });
  console.log(
    `Hosted SDK two-for-one and three-way finalized: ${results.map((attempt) => attempt.txid).join(", ")}. This is not browser-wallet proof.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message.replace(/https?:\/\/\S+/g, "[endpoint]")
        : "Hosted rehearsal failed; retain original journals",
    );
    process.exitCode = 1;
  });
