import { ProtocolError, TimeoutError } from "./errors.js";
import { eventStream, parseEventData } from "./streams.js";
import {
  Transport,
  RequestLifetime,
  addFile,
  artifactPath,
  positiveMs,
  segment,
} from "./transport.js";
import type * as T from "./types.js";
export * from "./types.js";
export * from "./errors.js";

const v1 = "/api/v1";
const chatPath = (id: string) => `${v1}/chat/${segment(id)}`;
const runPath = (id: string) => `${v1}/runs/${segment(id)}`;

export class Chat {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  create<Output = unknown>(
    request: T.ChatRequest,
    options?: T.RequestOptions,
  ): Promise<T.ChatResponse<Output>> {
    return this.#transport.json("POST", `${v1}/chat`, request, undefined, options);
  }
  delete(conversationID: string, options?: T.RequestOptions): Promise<void> {
    return this.#transport.json("DELETE", chatPath(conversationID), undefined, undefined, options);
  }
}
export class Files {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  upload(
    request: T.FilesUploadRequest,
    options?: T.RequestOptions,
  ): Promise<T.FilesUploadResponse> {
    if (!request.files.length) throw new TypeError("At least one file is required");
    const form = new FormData();
    if (request.conversation_id !== undefined) form.set("conversation_id", request.conversation_id);
    if (request.ttl_seconds !== undefined) form.set("ttl_seconds", String(request.ttl_seconds));
    for (const file of request.files) addFile(form, "file", file);
    return this.#transport.json("POST", `${v1}/chat/files`, form, undefined, options);
  }
  /** Consume response.body as a stream, or use response.blob()/text(); cancel unused bodies. */
  download(conversationID: string, path: string, options?: T.RequestOptions): Promise<Response> {
    return this.#transport.download(
      `${chatPath(conversationID)}/files/${artifactPath(path)}`,
      undefined,
      options,
    );
  }
}
export class Runs {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  create(request: T.RunRequest, options?: T.RequestOptions): Promise<T.RunCreated> {
    if (
      request.files?.some(
        (file) => !file || typeof file.id !== "string" || !file.id || "content_base64" in file,
      )
    )
      throw new TypeError("Async runs accept uploaded file IDs; upload files first");
    return this.#transport.json("POST", `${v1}/runs`, request, undefined, options);
  }
  get<Result = unknown>(
    runID: string,
    query?: T.RunQuery,
    options?: T.RequestOptions,
  ): Promise<T.RunSnapshot<Result>> {
    return this.#transport.json("GET", runPath(runID), undefined, query, options);
  }
  cancel(runID: string, options?: T.RequestOptions): Promise<T.RunCancelled> {
    return this.#transport.json("DELETE", runPath(runID), undefined, undefined, options);
  }
  /** Progress metadata with an explicit resume cursor; this iterator never reconnects. */
  async *events(
    runID: string,
    query?: T.RunQuery,
    options?: T.EventsOptions,
  ): AsyncGenerator<T.RunStreamEvent> {
    for await (const event of eventStream(
      this.#transport,
      "GET",
      `${runPath(runID)}/events`,
      undefined,
      query,
      options,
    )) {
      yield {
        ...(event.id === undefined ? {} : { id: event.id }),
        kind: event.event ?? "message",
        data: parseEventData(event.data),
      };
      if (["completed", "failed", "cancelled", "interaction_required"].includes(event.event ?? ""))
        return;
    }
    throw new ProtocolError(
      "Run event stream ended before a terminal event; resume with the last cursor",
    );
  }
  /** Local timeout leaves the server run intact; cancel() is an explicit separate operation. */
  async wait<Result = unknown>(
    runID: string,
    options: T.WaitOptions = {},
  ): Promise<T.RunSnapshot<Result>> {
    const timeoutMs = positiveMs(options.timeoutMs ?? 900_000);
    const interval = positiveMs(options.pollIntervalMs ?? 1000);
    const lifetime = new RequestLifetime(timeoutMs, options.signal);
    const deadline = performance.now() + timeoutMs;
    let after = options.after ?? 0;
    try {
      for (;;) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new TimeoutError();
        const snapshot = await lifetime.race(
          this.get<Result>(
            runID,
            { after },
            {
              signal: lifetime.signal,
              ...(options.runAs === undefined ? {} : { runAs: options.runAs }),
              timeoutMs: Math.min(remaining, this.#transport.timeoutMs),
              ...(options.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: options.idempotencyKey }),
            },
          ),
        );
        if (["completed", "failed", "cancelled", "interaction_required"].includes(snapshot.status))
          return snapshot;
        after = snapshot.next_after;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await lifetime.race(
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, interval);
            }),
          );
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    } catch (error) {
      if (lifetime.signal.aborted) throw lifetime.signal.reason;
      throw error;
    } finally {
      lifetime.dispose();
    }
  }
}
export class Skills {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  list(options?: T.RequestOptions): Promise<T.SkillsResponse> {
    return this.#transport.json("GET", `${v1}/skills`, undefined, undefined, options);
  }
}
export class Specialists {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  list(options?: T.RequestOptions): Promise<T.SpecialistsResponse> {
    return this.#transport.json("GET", `${v1}/specialists`, undefined, undefined, options);
  }
}
export class ExecutionPlan {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  defaults(options?: T.RequestOptions): Promise<T.ExecPlanDefaults> {
    return this.#transport.json("GET", `${v1}/exec-plan/defaults`, undefined, undefined, options);
  }
}
export class Conversations {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  create(
    request: T.ConversationRequest = {},
    options?: T.RequestOptions,
  ): Promise<T.ConversationCreated> {
    return this.#transport.json("POST", `${v1}/conversations`, request, undefined, options);
  }
  context(conversationID: string, options?: T.RequestOptions): Promise<T.ConversationContext> {
    return this.#transport.json(
      "GET",
      `${chatPath(conversationID)}/context`,
      undefined,
      undefined,
      options,
    );
  }
  setWorkspace(
    conversationID: string,
    request: { directory_id: string },
    options?: T.RequestOptions,
  ): Promise<T.ConversationContext> {
    return this.#transport.json(
      "PUT",
      `${chatPath(conversationID)}/workspace`,
      request,
      undefined,
      options,
    );
  }
  clearWorkspace(
    conversationID: string,
    options?: T.RequestOptions,
  ): Promise<T.ConversationContext> {
    return this.#transport.json(
      "DELETE",
      `${chatPath(conversationID)}/workspace`,
      undefined,
      undefined,
      options,
    );
  }
  addMemoryRef(
    conversationID: string,
    request: T.MemoryRefInput,
    options?: T.RequestOptions,
  ): Promise<T.ConversationContext> {
    return this.#transport.json(
      "POST",
      `${chatPath(conversationID)}/memory-refs`,
      request,
      undefined,
      options,
    );
  }
  updateMemoryRef(
    conversationID: string,
    refID: string,
    request: { access_mode: T.AccessMode },
    options?: T.RequestOptions,
  ): Promise<T.ConversationContext> {
    return this.#transport.json(
      "PATCH",
      `${chatPath(conversationID)}/memory-refs/${segment(refID)}`,
      request,
      undefined,
      options,
    );
  }
  deleteMemoryRef(
    conversationID: string,
    refID: string,
    options?: T.RequestOptions,
  ): Promise<void> {
    return this.#transport.json(
      "DELETE",
      `${chatPath(conversationID)}/memory-refs/${segment(refID)}`,
      undefined,
      undefined,
      options,
    );
  }
}
export class Memory {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  browse(query?: T.MemoryBrowseQuery, options?: T.RequestOptions): Promise<T.MemoryBrowseResponse> {
    return this.#transport.json("GET", `${v1}/memory/browse`, undefined, query, options);
  }
  collections(options?: T.RequestOptions): Promise<T.MemoryCollectionsResponse> {
    return this.#transport.json("GET", `${v1}/memory/collections`, undefined, undefined, options);
  }
  collectionMembers(
    collectionID: string,
    options?: T.RequestOptions,
  ): Promise<T.MemoryMembersResponse> {
    return this.#transport.json(
      "GET",
      `${v1}/memory/collections/${segment(collectionID)}/members`,
      undefined,
      undefined,
      options,
    );
  }
  createRoot(request: { name: string }, options?: T.RequestOptions): Promise<T.MemoryDirectory> {
    return this.#transport.json(
      "POST",
      `${v1}/memory/resources/roots`,
      request,
      undefined,
      options,
    );
  }
  createFolder(
    request: { directory_id: string; path: string },
    options?: T.RequestOptions,
  ): Promise<T.MemoryFolder> {
    return this.#transport.json(
      "POST",
      `${v1}/memory/resources/folders`,
      request,
      undefined,
      options,
    );
  }
  upload(
    request: T.MemoryUploadRequest,
    options?: T.RequestOptions,
  ): Promise<T.MemoryUploadResponse> {
    const form = new FormData();
    form.set("directory_id", request.directory_id);
    if (request.path !== undefined) form.set("path", request.path);
    if (request.conflict_policy !== undefined) form.set("conflict_policy", request.conflict_policy);
    addFile(form, "file", request.file);
    return this.#transport.json("POST", `${v1}/memory/resources/files`, form, undefined, options);
  }
  download(
    fileID: string,
    query: T.MemoryDownloadQuery,
    options?: T.RequestOptions,
  ): Promise<Response> {
    return this.#transport.download(
      `${v1}/memory/resources/files/${segment(fileID)}/content`,
      query,
      options,
    );
  }
}
export class Apps {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  create(request: T.AppCreateRequest, options?: T.RequestOptions): Promise<T.AppPublishResponse> {
    this.#transport.assertApps(options);
    const form = new FormData();
    addFile(form, "bundle", request.bundle);
    if (request.title !== undefined) form.set("title", request.title);
    return this.#transport.json(
      "POST",
      `${v1}/apps`,
      form,
      { activate: request.activate },
      options,
    );
  }
  publishVersion(
    appID: string,
    request: T.AppPublishRequest,
    options?: T.RequestOptions,
  ): Promise<T.AppPublishResponse> {
    this.#transport.assertApps(options);
    const form = new FormData();
    addFile(form, "bundle", request.bundle);
    return this.#transport.json(
      "POST",
      `${v1}/apps/${segment(appID)}/versions`,
      form,
      { activate: request.activate },
      options,
    );
  }
  get(
    appID: string,
    query: { version: string },
    options?: T.RequestOptions,
  ): Promise<T.AppPublicationResponse> {
    this.#transport.assertApps(options);
    return this.#transport.json("GET", `${v1}/apps/${segment(appID)}`, undefined, query, options);
  }
}
export class OpenAI {
  readonly #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  models(options?: T.RequestOptions): Promise<T.OpenAIModelsResponse> {
    return this.#transport.json("GET", "/api/openai/v1/models", undefined, undefined, options);
  }
  chatCompletions(
    request: T.OpenAIChatRequest & { stream: true },
    options?: T.RequestOptions,
  ): AsyncGenerator<T.OpenAIStreamChunk>;
  chatCompletions(
    request: T.OpenAIChatRequest & { stream?: false },
    options?: T.RequestOptions,
  ): Promise<T.OpenAIChatResponse>;
  chatCompletions(
    request: T.OpenAIChatRequest,
    options?: T.RequestOptions,
  ): Promise<T.OpenAIChatResponse> | AsyncGenerator<T.OpenAIStreamChunk>;
  chatCompletions(
    request: T.OpenAIChatRequest,
    options?: T.RequestOptions,
  ): Promise<T.OpenAIChatResponse> | AsyncGenerator<T.OpenAIStreamChunk> {
    return request.stream
      ? this.#stream(request, options)
      : this.#transport.json(
          "POST",
          "/api/openai/v1/chat/completions",
          request,
          undefined,
          options,
        );
  }
  async *#stream(
    request: T.OpenAIChatRequest,
    options?: T.RequestOptions,
  ): AsyncGenerator<T.OpenAIStreamChunk> {
    for await (const event of eventStream(
      this.#transport,
      "POST",
      "/api/openai/v1/chat/completions",
      request,
      undefined,
      options,
    )) {
      if (event.data === "[DONE]") return;
      let chunk: unknown;
      try {
        chunk = JSON.parse(event.data);
      } catch {
        throw new ProtocolError("OpenAI stream returned invalid JSON");
      }
      yield chunk as T.OpenAIStreamChunk;
    }
    throw new ProtocolError("OpenAI stream ended before [DONE]");
  }
}
/** Iskra's API-key client. Keep one delegation target per client. */
export class Iskra {
  readonly chat: Chat;
  readonly files: Files;
  readonly runs: Runs;
  readonly skills: Skills;
  readonly specialists: Specialists;
  readonly execPlan: ExecutionPlan;
  readonly conversations: Conversations;
  readonly memory: Memory;
  readonly apps: Apps;
  readonly openai: OpenAI;
  constructor(options: T.IskraOptions) {
    const transport = new Transport(options);
    this.chat = new Chat(transport);
    this.files = new Files(transport);
    this.runs = new Runs(transport);
    this.skills = new Skills(transport);
    this.specialists = new Specialists(transport);
    this.execPlan = new ExecutionPlan(transport);
    this.conversations = new Conversations(transport);
    this.memory = new Memory(transport);
    this.apps = new Apps(transport);
    this.openai = new OpenAI(transport);
  }
}
