import { APIError, AbortError, NetworkError, ProtocolError, TimeoutError } from "./errors.js";
import type { EventsOptions, IskraOptions, RequestOptions, UploadFile } from "./types.js";

export type Query = object;
export function segment(value: string): string {
  if (typeof value !== "string" || !value || value === "." || value === "..")
    throw new TypeError("A nonempty path ID is required");
  return encodeURIComponent(value);
}
export function artifactPath(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  )
    throw new TypeError("An artifact path relative to the conversation is required");
  return value.split("/").map(segment).join("/");
}
export function addFile(form: FormData, field: string, file: UploadFile): void {
  if (!file || !(file.data instanceof Blob) || typeof file.name !== "string" || !file.name.trim())
    throw new TypeError("A file requires a nonempty name and Blob data");
  form.append(field, file.data, file.name);
}
export function positiveMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647)
    throw new TypeError("timeout/interval must be positive milliseconds within the timer range");
  return value;
}

/** One deadline covers headers and consumption of the response body. */
export class RequestLifetime {
  readonly controller = new AbortController();
  readonly #timer: ReturnType<typeof setTimeout>;
  readonly #external: AbortSignal | undefined;
  readonly #externalAbort: () => void;
  constructor(timeoutMs: number, signal?: AbortSignal) {
    this.#timer = setTimeout(
      () => this.controller.abort(new TimeoutError()),
      positiveMs(timeoutMs),
    );
    this.#external = signal;
    this.#externalAbort = () => this.controller.abort(new AbortError());
    if (signal?.aborted) this.#externalAbort();
    else signal?.addEventListener("abort", this.#externalAbort, { once: true });
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  dispose(): void {
    clearTimeout(this.#timer);
    this.#external?.removeEventListener("abort", this.#externalAbort);
  }
  error(error: unknown): Error {
    if (this.signal.aborted) return this.signal.reason as Error;
    if (error instanceof APIError || error instanceof ProtocolError) return error;
    return new NetworkError();
  }
  async race<T>(promise: Promise<T>): Promise<T> {
    if (this.signal.aborted) {
      void promise.catch(() => {});
      throw this.signal.reason;
    }
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(this.signal.reason);
      this.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([promise, cancelled]);
    } finally {
      if (abort) this.signal.removeEventListener("abort", abort);
    }
  }
}
interface OpenResponse {
  response: Response;
  lifetime: RequestLifetime;
}

export class Transport {
  readonly #key: string;
  readonly #base: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #runAs: string | undefined;
  readonly timeoutMs: number;
  constructor(options: IskraOptions) {
    if (
      !options ||
      typeof options.apiKey !== "string" ||
      !options.apiKey.trim() ||
      /[\r\n]/.test(options.apiKey)
    )
      throw new TypeError("apiKey is required");
    if (typeof options.baseUrl !== "string" || !options.baseUrl.trim())
      throw new TypeError("baseUrl is required");
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.includes("?") ||
      url.href.includes("#")
    )
      throw new TypeError(
        "baseUrl must be an HTTP(S) origin and optional path prefix without credentials, query or fragment",
      );
    this.#key = options.apiKey;
    this.#base = url.href.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") throw new TypeError("fetch must be a function");
    if (
      options.runAs !== undefined &&
      (typeof options.runAs !== "string" || !options.runAs.trim() || /[\r\n]/.test(options.runAs))
    )
      throw new TypeError("runAs must be a nonempty profile ID");
    this.#runAs = options.runAs;
    this.timeoutMs = positiveMs(options.timeoutMs ?? 120_000);
  }
  assertApps(options?: RequestOptions): void {
    if (options?.runAs !== undefined || this.#runAs !== undefined)
      throw new TypeError(
        "Apps publication does not support runAs; use a client without delegation",
      );
  }
  #redact(value: string): string {
    return value
      .replaceAll(this.#key, "[REDACTED]")
      .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]");
  }
  async open(
    method: string,
    path: string,
    body: unknown,
    query: Query | undefined,
    options: EventsOptions = {},
    accept = "application/json",
  ): Promise<OpenResponse> {
    const url = new URL(this.#base + path);
    if (query)
      for (const [key, value] of Object.entries(query))
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const headers = new Headers({ authorization: "Bearer " + this.#key, accept });
    const runAs = options.runAs ?? this.#runAs;
    if (runAs !== undefined) {
      if (typeof runAs !== "string" || !runAs.trim() || /[\r\n]/.test(runAs))
        throw new TypeError("runAs must be a nonempty profile ID");
      headers.set("X-Iskra-Run-As", runAs);
    }
    if (options.idempotencyKey !== undefined)
      headers.set("Idempotency-Key", options.idempotencyKey);
    if (options.lastEventID !== undefined) headers.set("Last-Event-ID", options.lastEventID);
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers.set("Content-Type", "application/json");
    const lifetime = new RequestLifetime(options.timeoutMs ?? this.timeoutMs, options.signal);
    let response: Response | undefined;
    try {
      if (lifetime.signal.aborted) throw lifetime.signal.reason;
      const pending = this.#fetch(url, {
        method,
        headers,
        redirect: "manual",
        signal: lifetime.signal,
        ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
      });
      void pending.then(
        (value) => {
          if (lifetime.signal.aborted) void value.body?.cancel().catch(() => {});
        },
        () => {},
      );
      response = await lifetime.race(pending);
      if (!response.ok) {
        const rawBody = await readError(response, lifetime);
        const envelope = record(rawBody);
        const error = record(envelope.error);
        const code = string(error.code) ?? string(envelope.code);
        const message =
          string(error.message) ??
          string(envelope.detail) ??
          string(envelope.title) ??
          `Iskra API returned HTTP ${response.status}`;
        throw new APIError(
          this.#redact(message),
          {
            status: response.status,
            code,
            requestID: response.headers.get("x-request-id") ?? string(envelope.request_id),
            retryAfter: response.headers.get("retry-after") ?? undefined,
            rawBody,
          },
          (value) => this.#redact(value),
        );
      }
      return { response, lifetime };
    } catch (error) {
      void response?.body?.cancel().catch(() => {});
      lifetime.dispose();
      throw lifetime.error(error);
    }
  }
  async json<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
    options?: RequestOptions,
  ): Promise<T> {
    const { response, lifetime } = await this.open(method, path, body, query, options);
    try {
      if (response.status === 204) return undefined as T;
      try {
        return JSON.parse(await readText(response, lifetime)) as T;
      } catch (error) {
        if (error instanceof SyntaxError) throw new ProtocolError("Iskra returned invalid JSON");
        throw error;
      }
    } catch (error) {
      throw lifetime.error(error);
    } finally {
      void response.body?.cancel().catch(() => {});
      lifetime.dispose();
    }
  }
  async download(path: string, query?: Query, options?: RequestOptions): Promise<Response> {
    const { response, lifetime } = await this.open(
      "GET",
      path,
      undefined,
      query,
      options,
      "application/octet-stream",
    );
    if (!response.body) {
      lifetime.dispose();
      return response;
    }
    const reader = response.body.getReader();
    let done = false;
    let onAbort: () => void;
    const cleanup = () => {
      done = true;
      lifetime.signal.removeEventListener("abort", onAbort);
      lifetime.dispose();
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          onAbort = () => {
            if (done) return;
            controller.error(lifetime.signal.reason);
            void reader.cancel().catch(() => {});
            cleanup();
          };
          lifetime.signal.addEventListener("abort", onAbort, { once: true });
          if (lifetime.signal.aborted) onAbort();
        },
        async pull(controller) {
          try {
            const chunk = await lifetime.race(reader.read());
            if (done) return;
            if (chunk.done) {
              controller.close();
              reader.releaseLock();
              cleanup();
            } else controller.enqueue(chunk.value);
          } catch (error) {
            if (!done) {
              controller.error(lifetime.error(error));
              void reader.cancel().catch(() => {});
              cleanup();
            }
          }
        },
        async cancel() {
          cleanup();
          try {
            await reader.cancel();
          } finally {
            reader.releaseLock();
          }
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
async function readError(response: Response, lifetime: RequestLifetime): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json") || type.includes("+json")) {
    const text = await readText(response, lifetime);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text.slice(0, 8192);
    }
  }
  return readText(response, lifetime, 8192);
}
async function readText(
  response: Response,
  lifetime: RequestLifetime,
  limit = Infinity,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const chunk = await lifetime.race(reader.read());
      if (chunk.done) break;
      const bytes = chunk.value.subarray(0, limit - size);
      chunks.push(bytes);
      size += bytes.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* The connection may already be closed. */
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
