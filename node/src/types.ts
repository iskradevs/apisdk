/** JSON returned by the API remains intact, including fields added by future servers. */
export interface Extensible {
  [key: string]: unknown;
}
export interface IskraOptions {
  apiKey: string;
  /** Origin with an optional reverse-proxy prefix, without /api/v1. */
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /** Profile delegation is applied to every request on this client. */
  runAs?: string;
}
export interface RequestOptions {
  /** Override delegation for this operation; repeat the same target for its whole workflow. */
  runAs?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Explicit only. Requests are never automatically replayed. */
  idempotencyKey?: string;
}
export interface ExecOptions {
  profile_id?: string;
  complexity?: "simple" | "normal" | "hard";
  specialist_id?: string;
  secondary_specialist_id?: string;
  /** Omitted/null: automatic selection; []: explicitly select no skills. */
  skills?: string[] | null;
  antonym?: boolean;
}
export interface FileReference {
  id: string;
  content_base64?: never;
  name?: never;
  mime?: never;
}
export interface InlineFile {
  name: string;
  mime: string;
  content_base64: string;
  id?: never;
}
export interface ChatRequest {
  message: string;
  conversation_id?: string;
  instructions?: string;
  files?: (FileReference | InlineFile)[];
  ttl_seconds?: number;
  policy?: { inputs: Record<string, unknown> };
  include_reasoning?: boolean;
  iskra_exec?: ExecOptions;
  response_format?: { type: "json_schema"; json_schema: unknown };
}
export interface RunRequest extends Omit<ChatRequest, "files"> {
  files?: FileReference[];
}
export interface Artifact extends Extensible {
  name: string;
  download_url?: string;
}
export interface Interaction extends Extensible {
  tool_call_id: string;
  inputs: Array<{ name: string; label: string; type: string; required: boolean }>;
}
export interface ChatResponse<Output = unknown> extends Extensible {
  conversation_id: string;
  message_id?: string;
  status: "completed" | "interaction_required";
  answer?: string;
  usage: { input_tokens: number; output_tokens: number };
  expires_at?: string;
  interaction?: Interaction;
  reasoning?: string;
  files?: Artifact[];
  output?: Output;
}
/** Blob also accepts disk-backed blobs from node:fs openAsBlob. */
export interface UploadFile {
  name: string;
  data: Blob;
}
export interface FilesUploadRequest {
  files: UploadFile[];
  conversation_id?: string;
  ttl_seconds?: number;
}
export interface FilesUploadResponse extends Extensible {
  conversation_id: string;
  expires_at: string;
  files: Array<{ id: string; name: string; size: number }>;
}
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interaction_required";
export interface RunCreated extends Extensible {
  run_id: string;
  conversation_id: string;
  status: RunStatus;
  expires_at: string;
}
export interface RunCancelled extends Extensible {
  run_id: string;
  conversation_id: string;
  status: RunStatus;
}
export interface RunEvent extends Extensible {
  seq: number;
  ts: string;
  kind: string;
  data?: unknown;
}
/** Progress metadata, not a stream of answer tokens. IDs are opaque SSE strings. */
export interface RunStreamEvent {
  id?: string;
  kind: string;
  data: unknown;
}
export interface RunSnapshot<Result = unknown> extends Extensible {
  run_id: string;
  conversation_id: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: Result | null;
  error: { code: string; message: string } | null;
  events: RunEvent[];
  next_after: number;
}
export interface RunQuery {
  after?: number;
}
export interface EventsOptions extends RequestOptions {
  /** Explicit SSE resume header. The after query takes precedence on the server. */
  lastEventID?: string;
}
export interface WaitOptions extends RequestOptions {
  after?: number;
  pollIntervalMs?: number;
}
export interface Skill extends Extensible {
  bundle: string;
  name: string;
  title: string;
  description: string;
  version: string;
  mode: string;
  available: boolean;
  requires_setup: boolean;
  mandatory: boolean;
  setup_state: "ready" | "missing" | "invalid" | "unknown";
}
export interface SkillsResponse extends Extensible {
  skills: Skill[];
}
export interface Specialist extends Extensible {
  id: string;
  title: string;
  description: string;
  icon: string;
}
export interface SpecialistsResponse extends Extensible {
  specialists: Specialist[];
}
export interface ExecPlan extends Extensible {
  model: {
    source: string;
    profile_id?: string;
    complexity: string;
    antonym_enabled: boolean;
    antonym_locked: boolean;
    route_role?: string;
    route_coeff?: number;
    reasoning_effort?: string;
    fallback_active?: boolean;
    degraded?: string;
  };
  specialist: {
    source: string;
    id: string;
    title?: string;
    icon?: string;
    secondary?: { id: string; title?: string; icon?: string };
    degraded?: string;
  };
  skills: {
    source: string;
    skills: Array<{ bundle: string; mandatory: boolean; ephemeral: boolean }>;
    degraded?: string;
  };
  memory: { folder_ids: string[] };
  context: { tokens: number; limit: number };
  version: number;
}
export interface ExecPlanDefaults extends Extensible {
  plan: ExecPlan;
  pins: {
    model: { profile_id?: string; complexity: string; antonym_enabled: boolean | null } | null;
    skills: { skill_ids: string[] } | null;
    specialist: { specialist_id: string; secondary_specialist_id?: string } | null;
  };
  version: number;
  options: {
    complexity_levels: Array<{
      level: string;
      coeff: number;
      coeff_known: boolean;
      vision_ok: boolean;
      auto: boolean;
    }>;
    router_enabled: boolean;
    antonym: string;
    mandatory_bundles: string[];
    memory: { folder_ids: string[] };
    specialists: Specialist[];
  };
}
export type AccessMode = "read" | "write";
export interface FolderLocator {
  directory_id: string;
  folder_id?: string;
}
export type MemoryRefInput = { access_mode: AccessMode } & (
  | { locator: FolderLocator; collection_id?: never }
  | { collection_id: string; locator?: never }
);
export interface ConversationRequest {
  ttl_seconds?: number;
  workspace_directory_id?: string;
  memory_refs?: MemoryRefInput[];
}
export interface Workspace extends Extensible {
  directory_id?: string;
  name: string;
  access_mode: AccessMode;
  adopted?: boolean;
  can_choose?: boolean;
  can_release?: boolean;
  access_denied?: boolean;
}
export interface MemoryReference extends Extensible {
  id: string;
  origin: string;
  inherited: boolean;
  locator: FolderLocator;
  collection_id?: string;
  name: string;
  root_name: string;
  path?: string;
  access_mode: AccessMode;
  can_write: boolean;
  can_remove: boolean;
  can_change_mode: boolean;
  resource_denied: boolean;
}
export interface ConversationContext extends Extensible {
  workspace: Workspace;
  references: MemoryReference[];
  archived?: boolean;
  session_missing?: boolean;
}
export interface ConversationCreated extends ConversationContext {
  conversation_id: string;
  expires_at: string | null;
}
export interface MemoryBrowseQuery {
  directory_id?: string;
  folder_id?: string;
  q?: string;
  sort?: "name" | "created_at";
  direction?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  origin?: "personal" | "project" | "chat" | "synced" | "shared";
  target_kind?: "folder" | "file";
  candidates?: boolean;
}
export interface MemoryLocator extends FolderLocator {
  target_kind: "folder" | "file";
  file_id?: string;
}
export interface MemoryEntry extends Extensible {
  locator: MemoryLocator;
  name: string;
  path: string;
  root_name: string;
  origin: string;
  category?: string;
  origin_id?: string;
  permission: string;
  tree_revision: number;
  processing_revision: number;
  mime?: string;
  size_bytes?: number;
  file_source?: string;
  file_status?: string;
  current_version_id?: string;
  checksum_sha256?: string;
  processing?: Extensible;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  file_count?: number;
  total_size_bytes?: number;
  workspace_adopted?: boolean;
}
export interface MemoryBrowseResponse extends Extensible {
  entries: MemoryEntry[];
  complete: boolean;
  next_cursor?: string;
  breadcrumbs?: Array<{ name: string; locator: MemoryLocator }>;
  pinned_roots?: MemoryEntry[];
  materialization_file_limit: number;
}
export interface MemoryCollection extends Extensible {
  id: string;
  name: string;
  member_count: number;
  origin: string;
  autofill_mode: string;
}
export interface MemoryCollectionMember extends Extensible {
  directory_id: string;
  folder_id?: string;
  name: string;
  root_name: string;
  path: string;
  shared: boolean;
}
export interface MemoryCollectionsResponse extends Extensible {
  collections: MemoryCollection[];
}
export interface MemoryMembersResponse extends Extensible {
  members: MemoryCollectionMember[];
}
export interface MemoryDirectory extends Extensible {
  id: string;
  org_id?: string;
  name: string;
  type: string;
  created_by: string;
  owner_kind: string;
  tree_revision: number;
  processing_revision: number;
  created_at: string;
  updated_at: string;
}
export interface MemoryFolder extends Extensible {
  id: string;
  directory_id: string;
  path: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}
export interface MemoryFile extends Extensible {
  id: string;
  directory_id: string;
  path: string;
  mime: string;
  size_bytes?: number;
  checksum_sha256?: string;
  current_version_id?: string;
  source: string;
  skill_bundle?: string;
  status: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export interface MemoryFileVersion extends Extensible {
  id: string;
  file_id: string;
  version_number: number;
  s3_version_id: string;
  size_bytes?: number;
  checksum_sha256?: string;
  created_by?: string;
  message_id?: string;
  created_at: string;
}
export interface MemoryDownloadQuery {
  directory_id: string;
  download?: "1" | "0";
  format?: "pdf" | "spreadsheet" | "spreadsheet-asset";
  asset?: string;
}
export interface MemoryUploadRequest {
  directory_id: string;
  file: UploadFile;
  path?: string;
  conflict_policy?: "create" | "rename";
}
export interface MemoryUploadResponse extends Extensible {
  file: MemoryFile;
  version: MemoryFileVersion;
}
export interface AppPublishRequest {
  bundle: UploadFile;
  activate?: boolean;
}
export interface AppCreateRequest extends AppPublishRequest {
  title?: string;
}
export interface AppPublishResponse extends Extensible {
  id: string;
  slug: string;
  version: string;
  state: string;
  current_version?: string;
  activated: boolean;
  approval_pending: boolean;
}
export interface AppPublication extends Extensible {
  version: string;
  state: string;
  probe_error?: string;
  activate_on_ready: boolean;
  outcome?: string;
}
export interface AppPublicationResponse extends Extensible {
  id: string;
  slug: string;
  title: string;
  access: string;
  status: string;
  current_version?: string;
  approved_version?: string;
  publication: AppPublication;
}
export interface OpenAIToolCall extends Extensible {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface OpenAIMessage extends Extensible {
  role: string;
  content:
    | string
    | null
    | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
  name?: string;
}
export interface OpenAIChatRequest extends Extensible {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  conversation_id?: string;
  policy?: { inputs: Record<string, unknown> };
  iskra_exec?: ExecOptions;
  /** json_object applies to raw models; the agent model accepts text. */
  response_format?: { type: "text" | "json_object" };
  n?: number;
  /** Raw-model parameters; the agent model controls its own tools and generation. */
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters: unknown; strict?: boolean };
  }>;
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  seed?: number;
  reasoning_effort?: string;
  enable_thinking?: boolean;
  thinking_budget?: number;
  chat_template_kwargs?: Record<string, unknown>;
}
export interface OpenAIUsage extends Extensible {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
export interface OpenAIChatResponse extends Extensible {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      reasoning_content?: string;
    };
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: unknown[];
      reasoning_content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: OpenAIUsage | null;
  conversation_id?: string;
  files?: Artifact[];
  interaction?: Interaction;
}
export interface OpenAIModelsResponse extends Extensible {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    [key: string]: unknown;
  }>;
}

/** Streaming errors arrive as JSON error envelopes after the HTTP 200 headers. */
export interface OpenAIStreamError extends Extensible {
  error: { message: string; type: string; code?: string };
}
export type OpenAIStreamChunk = OpenAIChatResponse | OpenAIStreamError;
