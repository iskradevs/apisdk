const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

/** An HTTP refusal. rawBody retains JSON envelopes, including partial chat answers. */
export class APIError extends Error {
  readonly #redact: (value: string) => string;
  readonly status: number;
  readonly code: string | undefined;
  readonly requestID: string | undefined;
  readonly retryAfter: string | undefined;
  readonly rawBody: unknown;
  constructor(
    message: string,
    details: {
      status: number;
      code?: string | undefined;
      requestID?: string | undefined;
      retryAfter?: string | undefined;
      rawBody: unknown;
    },
    redact: (value: string) => string = (value) => value,
  ) {
    super(message);
    this.name = "APIError";
    this.#redact = redact;
    this.status = details.status;
    this.code = details.code;
    this.requestID = details.requestID;
    this.retryAfter = details.retryAfter;
    this.rawBody = details.rawBody;
  }
  toJSON(): object {
    const safe = (value: string | undefined) =>
      value === undefined ? undefined : this.#redact(value);
    return {
      name: this.name,
      message: safe(this.message),
      status: this.status,
      code: safe(this.code),
      requestID: safe(this.requestID),
      retryAfter: safe(this.retryAfter),
    };
  }
  [inspectSymbol](): object {
    return this.toJSON();
  }
}
export class NetworkError extends Error {
  constructor() {
    super("Could not reach the Iskra API");
    this.name = "NetworkError";
  }
}
export class TimeoutError extends Error {
  constructor() {
    super("Iskra request deadline exceeded");
    this.name = "TimeoutError";
  }
}
export class AbortError extends Error {
  constructor() {
    super("Iskra request aborted");
    this.name = "AbortError";
  }
}
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}
