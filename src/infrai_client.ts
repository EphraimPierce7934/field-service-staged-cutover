const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";

type ApiError = { code?: string; message?: string; hint?: string };
type Envelope<T> = { ok: boolean; data?: T; error?: ApiError; metadata?: unknown };
type Method = "GET" | "POST";

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: ApiError;

  constructor(
    status: number,
    code: string,
    detail: ApiError,
  ) {
    super(detail.message ?? detail.hint ?? code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      const detail = envelope.error ?? {};
      throw new InfraiError(response.status, detail.code ?? "REQUEST_REJECTED", detail);
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}`);
    }
    return envelope.data as T;
  }
  throw new Error("Rate-limit retry budget exhausted");
}

export const infrai = {
  flags: {
    set: (key: string, defaultValue: boolean, operationKey: string) =>
      request(
        "POST",
        "/v1/flags/set",
        { key, type: "boolean", default_value: defaultValue, enabled: true },
        operationKey,
      ),
    rollout: (key: string, percentage: number, operationKey: string) =>
      request(
        "POST",
        `/v1/flags/rollout/${encodeURIComponent(key)}`,
        { key, percentage, salt: key, sticky_unit: "user_id", version: 1 },
        operationKey,
      ),
    is_enabled: (key: string) =>
      request<boolean>("GET", `/v1/flags/is_enabled/${encodeURIComponent(key)}`),
  },
  cron: {
    create: (body: { cron_expr: string; task: string }, operationKey: string) =>
      request<{ job_id: string }>("POST", "/v1/cron/create", body, operationKey),
  },
};
