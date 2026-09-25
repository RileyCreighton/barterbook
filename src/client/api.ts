export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal: AbortSignal.timeout(20_000),
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result: { error?: string; message?: string };
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
  if (!response.ok)
    throw new ApiError(
      result.error ?? result.message ?? `Request failed (${response.status})`,
      response.status,
    );
  return result as T;
}
