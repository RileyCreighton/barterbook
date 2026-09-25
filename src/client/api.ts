export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
let expectedWallet: string | null = null;
let identityGeneration = 0;
const mismatchListeners = new Set<() => void>();

export function setExpectedWallet(wallet: string | null) {
  expectedWallet = wallet;
  identityGeneration++;
}

export function onWalletIdentityMismatch(listener: () => void) {
  mismatchListeners.add(listener);
  return () => {
    mismatchListeners.delete(listener);
  };
}

function needsIdentity(path: string, body: unknown): boolean {
  const pathname = path.split("?", 1)[0];
  if (["/auth/challenge", "/auth/verify"].includes(pathname)) return false;
  if (body !== undefined) return true;
  return (
    ![
      "/health",
      "/assets",
      "/listings",
      "/matches",
      "/demo",
      "/history",
      "/auth/me",
    ].includes(pathname) && !pathname.startsWith("/receipts/")
  );
}

export async function api<T>(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
  options?: { expectedWallet: string },
): Promise<T> {
  const requestWallet = options?.expectedWallet ?? expectedWallet;
  const generation = identityGeneration;
  const privateRequest = needsIdentity(path, body);
  if (privateRequest && !requestWallet)
    throw new ApiError("Connect your wallet and authenticate first.", 401);
  const response = await fetch(`/api${path}`, {
    signal: AbortSignal.timeout(20_000),
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...(requestWallet
        ? { "X-BarterBook-Expected-Wallet": requestWallet }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result: { error?: string; message?: string; code?: string };
  try {
    result = JSON.parse(text);
  } catch {
    throw new ApiError(
      response.ok
        ? "The application API is unavailable. Reload your original trade state before trying again."
        : `The API request failed (${response.status}).`,
      response.status,
    );
  }
  if (
    response.status === 409 &&
    result.code === "WALLET_IDENTITY_MISMATCH" &&
    generation === identityGeneration &&
    requestWallet === expectedWallet
  ) {
    setExpectedWallet(null);
    for (const listener of mismatchListeners) listener();
  }
  if (!response.ok)
    throw new ApiError(
      result.error ?? result.message ?? `Request failed (${response.status})`,
      response.status,
    );
  if (privateRequest && !options && generation !== identityGeneration)
    throw new ApiError(
      "Wallet changed while the request was in progress. Reconnect and reload the original state.",
      409,
    );
  return result as T;
}
