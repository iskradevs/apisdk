"""Wire types. Responses stay ordinary dictionaries and retain unknown server fields."""

from __future__ import annotations

from dataclasses import dataclass
from typing import BinaryIO, Literal, NotRequired, Required, TypeAlias, TypedDict

JSONValue: TypeAlias = "None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]"
JSONObject: TypeAlias = dict[str, JSONValue]
AccessMode: TypeAlias = Literal["read", "write"]
RunStatus: TypeAlias = Literal[
    "queued", "running", "completed", "failed", "cancelled", "interaction_required"
]


@dataclass(frozen=True)
class RequestOptions:
    """Per-call headers and timeout. None inherits the client's value."""

    idempotency_key: str | None = None
    run_as: str | None = None
    timeout_seconds: float | None = None
    last_event_id: str | None = None


@dataclass(frozen=True)
class UploadFile:
    """Caller-owned binary file. HTTPX rewinds seekable streams before upload.

    Pass bytes containing the desired slice to upload part of a seekable file.
    """

    filename: str
    content: BinaryIO | bytes
    content_type: str = "application/octet-stream"


class IskraExec(TypedDict, total=False):
    profile_id: str
    complexity: Literal["simple", "normal", "hard"]
    skills: list[str] | None
    antonym: bool | None
    specialist_id: str
    secondary_specialist_id: str


class FileReference(TypedDict):
    id: str


class InlineFile(TypedDict):
    name: str
    mime: str
    content_base64: str


class Policy(TypedDict):
    inputs: JSONObject


class ResponseFormat(TypedDict):
    type: Literal["json_schema"]
    json_schema: JSONObject


class _TurnRequest(TypedDict, total=False):
    message: Required[str]
    conversation_id: str
    instructions: str
    ttl_seconds: int
    policy: Policy | None
    include_reasoning: bool
    iskra_exec: IskraExec | None
    response_format: ResponseFormat | None


class ChatRequest(_TurnRequest, total=False):
    files: list[FileReference | InlineFile]


class RunRequest(_TurnRequest, total=False):
    files: list[FileReference]


class Usage(TypedDict):
    input_tokens: int
    output_tokens: int


class Artifact(TypedDict):
    name: str
    download_url: NotRequired[str]


class InteractionField(TypedDict):
    name: str
    label: str
    type: str
    required: bool


class Interaction(TypedDict):
    tool_call_id: str
    inputs: list[InteractionField]


class ChatResponse(TypedDict):
    conversation_id: str
    status: Literal["completed", "interaction_required"]
    usage: Usage
    message_id: NotRequired[str]
    answer: NotRequired[str]
    expires_at: NotRequired[str]
    interaction: NotRequired[Interaction]
    reasoning: NotRequired[str]
    files: NotRequired[list[Artifact]]
    output: NotRequired[JSONValue]


class UploadedFile(TypedDict):
    id: str
    name: str
    size: int


class UploadResponse(TypedDict):
    conversation_id: str
    expires_at: str
    files: list[UploadedFile]


class RunCreated(TypedDict):
    run_id: str
    conversation_id: str
    status: RunStatus
    expires_at: str


class RunError(TypedDict):
    code: str
    message: str


class RunEvent(TypedDict):
    seq: int
    ts: str
    kind: str
    data: NotRequired[JSONValue]


class PartialRunResult(TypedDict, total=False):
    answer: str


class RunSnapshot(TypedDict):
    run_id: str
    conversation_id: str
    status: RunStatus
    created_at: str
    started_at: str | None
    finished_at: str | None
    result: ChatResponse | PartialRunResult | None
    error: RunError | None
    events: list[RunEvent]
    next_after: int


class RunCancelled(TypedDict):
    run_id: str
    conversation_id: str
    status: RunStatus


@dataclass(frozen=True)
class RunSSEEvent:
    """Progress metadata, not answer tokens. Resume with after=int(id)+1."""

    event: str
    data: JSONValue
    id: str
    retry: int | None = None


@dataclass(frozen=True)
class OpenAIChunk:
    data: JSONObject
    event: str = "message"
    id: str = ""


@dataclass(frozen=True)
class OpenAIDone:
    """The distinct [DONE] stream terminator."""


class Skill(TypedDict):
    bundle: str
    name: str
    title: str
    description: str
    version: str
    mode: str
    available: bool
    requires_setup: bool
    mandatory: bool
    setup_state: Literal["ready", "missing", "invalid", "unknown"]


class SkillsResponse(TypedDict):
    skills: list[Skill]


class Specialist(TypedDict):
    id: str
    title: str
    description: str
    icon: str


class SpecialistsResponse(TypedDict):
    specialists: list[Specialist]


class ExecModel(TypedDict):
    source: str
    profile_id: NotRequired[str]
    complexity: str
    antonym_enabled: bool
    antonym_locked: bool
    route_role: NotRequired[str]
    route_coeff: NotRequired[float]
    reasoning_effort: NotRequired[str]
    fallback_active: NotRequired[bool]
    degraded: NotRequired[str]


class SecondarySpecialist(TypedDict):
    id: str
    title: NotRequired[str]
    icon: NotRequired[str]


class ExecSpecialist(SecondarySpecialist):
    source: str
    secondary: NotRequired[SecondarySpecialist]
    degraded: NotRequired[str]


class ExecSkill(TypedDict):
    bundle: str
    mandatory: bool
    ephemeral: bool


class ExecSkills(TypedDict):
    source: str
    skills: list[ExecSkill]
    degraded: NotRequired[str]


class ExecMemory(TypedDict):
    folder_ids: list[str]


class ExecContext(TypedDict):
    tokens: int
    limit: int


class ExecutionPlan(TypedDict):
    model: ExecModel
    specialist: ExecSpecialist
    skills: ExecSkills
    memory: ExecMemory
    context: ExecContext
    version: int


class ModelPin(TypedDict):
    profile_id: NotRequired[str]
    complexity: str
    antonym_enabled: bool | None


class SkillsPin(TypedDict):
    skill_ids: list[str]


class SpecialistPin(TypedDict):
    specialist_id: str
    secondary_specialist_id: NotRequired[str]


class ExecPins(TypedDict):
    model: ModelPin | None
    skills: SkillsPin | None
    specialist: SpecialistPin | None


class ComplexityLevel(TypedDict):
    level: str
    coeff: float
    coeff_known: bool
    vision_ok: bool
    auto: bool


class ExecOptions(TypedDict):
    complexity_levels: list[ComplexityLevel]
    router_enabled: bool
    antonym: str
    mandatory_bundles: list[str]
    memory: ExecMemory
    specialists: list[Specialist]


class ExecPlanDefaults(TypedDict):
    plan: ExecutionPlan
    pins: ExecPins
    version: int
    options: ExecOptions


class MemoryFolderLocator(TypedDict):
    directory_id: str
    folder_id: NotRequired[str]


class MemoryLocator(MemoryFolderLocator):
    target_kind: Literal["folder", "file"]
    file_id: NotRequired[str]


class FolderReference(TypedDict):
    locator: MemoryFolderLocator
    access_mode: AccessMode


class CollectionReference(TypedDict):
    collection_id: str
    access_mode: AccessMode


MemoryReferenceInput: TypeAlias = FolderReference | CollectionReference


class ConversationRequest(TypedDict, total=False):
    ttl_seconds: int
    workspace_directory_id: str
    memory_refs: list[MemoryReferenceInput]


class Workspace(TypedDict, total=False):
    directory_id: str
    can_choose: bool
    can_release: bool
    access_mode: AccessMode
    adopted: bool
    access_denied: bool
    name: str


class MemoryReference(TypedDict, total=False):
    id: Required[str]
    locator: MemoryFolderLocator
    collection_id: str
    access_mode: AccessMode
    origin: str
    inherited: bool
    name: str
    root_name: str
    path: str
    can_write: bool
    can_change_mode: bool
    resource_denied: bool
    can_remove: bool


class ContextSnapshot(TypedDict):
    workspace: Workspace
    references: list[MemoryReference]
    archived: NotRequired[bool]
    session_missing: NotRequired[bool]


class ConversationCreated(ContextSnapshot):
    conversation_id: str
    expires_at: str | None


class MemoryBrowseQuery(TypedDict, total=False):
    directory_id: str
    folder_id: str
    q: str
    sort: Literal["name", "created_at"]
    direction: Literal["asc", "desc"]
    cursor: str
    limit: int
    origin: Literal["personal", "project", "chat", "synced", "shared"]
    target_kind: Literal["folder", "file"]
    candidates: bool


class MemoryEntry(TypedDict, total=False):
    locator: Required[MemoryLocator]
    name: Required[str]
    path: Required[str]
    root_name: str
    origin: str
    category: str
    origin_id: str
    permission: str
    tree_revision: int
    processing_revision: int
    mime: str
    size_bytes: int
    file_status: str
    file_source: str
    pinned: bool
    current_version_id: str
    checksum_sha256: str
    created_at: str
    updated_at: str
    processing: JSONObject
    file_count: int
    total_size_bytes: int
    workspace_adopted: bool


class MemoryBreadcrumb(TypedDict):
    name: str
    locator: MemoryLocator


class MemoryBrowsePage(TypedDict, total=False):
    entries: Required[list[MemoryEntry]]
    pinned_roots: list[MemoryEntry]
    breadcrumbs: list[MemoryBreadcrumb]
    next_cursor: str
    complete: bool
    materialization_file_limit: int


class MemoryCollection(TypedDict):
    id: str
    name: str
    member_count: int
    origin: str
    autofill_mode: str


class MemoryCollections(TypedDict):
    collections: list[MemoryCollection]


class MemoryCollectionMember(TypedDict):
    directory_id: str
    folder_id: NotRequired[str]
    name: str
    root_name: str
    path: str
    shared: bool


class MemoryMembers(TypedDict):
    members: list[MemoryCollectionMember]


class MemoryRoot(TypedDict):
    id: str
    org_id: NotRequired[str]
    name: str
    type: str
    created_by: str
    owner_kind: str
    tree_revision: int
    processing_revision: int
    created_at: str
    updated_at: str


class MemoryFolder(TypedDict):
    id: str
    directory_id: str
    path: str
    created_by: str
    created_at: str
    updated_at: str
    deleted_at: NotRequired[str]


class MemoryFile(TypedDict):
    id: str
    directory_id: str
    path: str
    mime: str
    size_bytes: NotRequired[int]
    current_version_id: NotRequired[str]
    checksum_sha256: NotRequired[str]
    source: str
    skill_bundle: NotRequired[str]
    status: str
    created_by: NotRequired[str]
    metadata: NotRequired[JSONObject]
    created_at: str
    updated_at: str


class MemoryVersion(TypedDict):
    id: str
    file_id: str
    version_number: int
    s3_version_id: str
    size_bytes: NotRequired[int]
    checksum_sha256: NotRequired[str]
    created_by: NotRequired[str]
    message_id: NotRequired[str]
    created_at: str


class MemoryUpload(TypedDict):
    file: MemoryFile
    version: MemoryVersion


class AppPublished(TypedDict):
    id: str
    slug: str
    version: str
    state: str
    current_version: NotRequired[str]
    activated: bool
    approval_pending: bool


class AppPublication(TypedDict):
    version: str
    state: str
    activate_on_ready: bool
    probe_error: NotRequired[str]
    outcome: NotRequired[str]


class AppStatus(TypedDict, total=False):
    id: Required[str]
    slug: str
    current_version: str
    approved_version: str
    title: str
    access: str
    status: str
    publication: AppPublication


class OpenAIMessage(TypedDict, total=False):
    role: Required[str]
    content: str | list[JSONObject] | None
    tool_calls: list[JSONObject]
    tool_call_id: str
    name: str


class OpenAIChatRequest(TypedDict, total=False):
    model: Required[str]
    messages: Required[list[OpenAIMessage]]
    conversation_id: str
    policy: Policy
    iskra_exec: IskraExec
    stream_options: JSONObject
    tools: list[JSONObject]
    tool_choice: JSONValue
    response_format: JSONObject
    temperature: float
    top_p: float
    max_tokens: int
    seed: int
    stop: str | list[str]
    reasoning_effort: str
    enable_thinking: bool
    thinking_budget: int
    chat_template_kwargs: JSONObject
    n: int
    frequency_penalty: float
    presence_penalty: float
    user: str
    store: bool
    metadata: JSONObject


class OpenAIChoice(TypedDict, total=False):
    index: Required[int]
    message: OpenAIMessage
    delta: OpenAIMessage
    finish_reason: str | None


class OpenAIUsage(TypedDict):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    prompt_tokens_details: NotRequired[JSONObject]


class OpenAIChatResponse(TypedDict):
    id: str
    object: str
    created: int
    model: str
    choices: list[OpenAIChoice]
    usage: NotRequired[OpenAIUsage]
    conversation_id: NotRequired[str]
    files: NotRequired[list[Artifact]]
    interaction: NotRequired[Interaction]


class OpenAIModel(TypedDict):
    id: str
    object: str
    created: int
    owned_by: str


class OpenAIModels(TypedDict):
    object: str
    data: list[OpenAIModel]
