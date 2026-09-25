export type Cluster = "devnet" | "mainnet-beta";
export interface FeeSchedule {
  epoch: string;
  basisPoints: number;
  maximumFeeRaw: string;
}
export interface Asset {
  cluster: Cluster;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: string;
  hasTransferFee: boolean;
  olderFee: FeeSchedule;
  newerFee: FeeSchedule;
  observedEpoch: string;
  observedSlot: string;
  observedAt: number;
  extensions: number[];
  multiplier: string;
  pendingMultiplier: string;
  tested: boolean;
  mock: boolean;
}
export interface TransferLeg {
  fromOwner: string;
  toOwner: string;
  mint: string;
  tokenProgram: string;
  sourceAccount: string;
  destinationATA: string;
  grossRaw: string;
  expectedFeeRaw: string;
  netRaw: string;
  decimals: number;
}
export interface MinimumReceipt {
  owner: string;
  mint: string;
  minNetRaw: string;
}
export interface Terms {
  cluster: Cluster;
  version: number;
  mode: "BASKET" | "RING";
  owners: string[];
  feePayer: string;
  maxNetworkFeeLamports: string;
  maxAccountRentLamports: string;
  legs: TransferLeg[];
  minima: MinimumReceipt[];
  expiresAt: number;
}
export interface Listing {
  id: string;
  owner: string;
  cluster: Cluster;
  giveMint: string;
  wantMint: string;
  grossRaw: string;
  minReceiveNetRaw: string;
  expiresAt: number;
  version: number;
  status: "OPEN" | "WITHDRAWN" | "FILLED";
  createdAt: number;
  balanceRaw?: string;
  balanceCheckedAt?: number;
  locked?: boolean;
}
export interface Match {
  id: string;
  mode: "BASKET" | "RING";
  listings: Listing[];
  legs: TransferLeg[];
  minima: MinimumReceipt[];
}
export interface FrozenPlan {
  terms: Terms;
  assets: Asset[];
  blockhash: string;
  lastValidBlockHeight: string;
  contextSlot: string;
  computeUnitLimit: number;
  microLamports: string;
  createAtas: string[];
  networkFeeLamports: string;
  accountRentLamports: string;
}
export type AttemptState =
  | "SIGNING"
  | "FULLY_SIGNED"
  | "SUBMISSION_STARTED"
  | "SUBMITTED"
  | "STATUS_UNKNOWN"
  | "CONFIRMED"
  | "FINALIZED"
  | "FAILED_ONCHAIN"
  | "EXPIRED_UNLANDED"
  | "STOPPED";
export interface Attempt {
  id: string;
  roomId: string;
  termsHash: string;
  plan: FrozenPlan;
  messageBase64: string;
  messageHash: string;
  wireBase64: string;
  fullWireBase64: string | null;
  txid: string | null;
  state: AttemptState;
  signatures: Record<string, string>;
  createdAt: number;
  submissionStartedAt: number | null;
  lastCheckedAt: number | null;
  stopRequested: boolean;
  safeToRetry: boolean;
  receipt: Receipt | null;
  error: string | null;
  successObserved?: boolean;
  lastRecoveryObservations?: import("./recovery").ChainObservation[];
  publicEvidence?: {
    observedAt: number;
    buildId: string | null;
    transaction: import("./receipt").TransactionEvidence;
  };
}
/** A momentary signing check, never evidence that an attempt may be replaced. */
export interface SigningStatus {
  attemptId: string;
  network: "devnet";
  buildId: string | null;
  checkedAt: number;
  currentBlockHeight: string;
  lastValidBlockHeight: string;
  blockhashValid: boolean;
  expired: boolean;
  signingAllowed: boolean;
  reason: string | null;
}
export interface ReceiptDelta {
  account: string;
  owner: string;
  mint: string;
  preRaw: string;
  postRaw: string;
  deltaRaw: string;
}
export interface Receipt {
  txid: string;
  cluster: Cluster;
  slot: string;
  blockTime?: number | null;
  status: "CONFIRMED" | "FINALIZED";
  networkFeeLamports: string;
  accountRentLamports: string;
  issuerFees: { mint: string; feeRaw: string }[];
  deltas: ReceiptDelta[];
  verified: boolean;
}
export interface RoomMember {
  wallet: string;
  acceptedVersion: number | null;
  ready: boolean;
}
export interface Room {
  id: string;
  terms: Terms;
  termsHash: string;
  members: RoomMember[];
  state: string;
  attempt: Attempt | null;
  createdAt: number;
  listingIds: string[];
}
export interface Holding {
  asset: Asset;
  account: string;
  amountRaw: string;
  supported: boolean;
  reason?: string;
  checkedAt: number;
}
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  SOLANA_CLUSTER: Cluster;
  SOLANA_RPC_URL?: string;
  SOLANA_RPC_FALLBACK_URL?: string;
  SETTLEMENT_ENABLED: string;
  DEVNET_ASSETS_JSON?: string;
  RPC_HISTORY_TRUSTED?: string;
  FALLBACK_HISTORY_TRUSTED?: string;
  RPC_ADDRESS_HISTORY_TRUSTED?: string;
  FALLBACK_ADDRESS_HISTORY_TRUSTED?: string;
  DEMO_PARTICIPANTS_JSON?: string;
  SITE_URL?: string;
  REPOSITORY_URL?: string;
  BUILD_ID?: string;
}
