from __future__ import annotations

from types import TracebackType
from typing import Self

import httpx

from ._resources import (
    Apps,
    Chat,
    Conversations,
    ExecPlan,
    Files,
    Memory,
    OpenAI,
    Runs,
    Skills,
    Specialists,
)
from ._resources_async import (
    AsyncApps,
    AsyncChat,
    AsyncConversations,
    AsyncExecPlan,
    AsyncFiles,
    AsyncMemory,
    AsyncOpenAI,
    AsyncRuns,
    AsyncSkills,
    AsyncSpecialists,
)
from ._transport import AsyncTransport, SyncTransport


class Iskra:
    """Sync client. timeout_seconds defaults to 120; no automatic retries."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_seconds: float = 120,
        run_as: str | None = None,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._transport = SyncTransport(
            api_key=api_key,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            run_as=run_as,
            http_client=http_client,
        )
        self.chat = Chat(self._transport)
        self.files = Files(self._transport)
        self.runs = Runs(self._transport)
        self.skills = Skills(self._transport)
        self.specialists = Specialists(self._transport)
        self.exec_plan = ExecPlan(self._transport)
        self.conversations = Conversations(self._transport)
        self.memory = Memory(self._transport)
        self.apps = Apps(self._transport)
        self.openai = OpenAI(self._transport)

    def __repr__(self) -> str:
        return "Iskra()"

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()


class AsyncIskra:
    """Async client. Injected HTTPX clients remain caller-owned."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_seconds: float = 120,
        run_as: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._transport = AsyncTransport(
            api_key=api_key,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            run_as=run_as,
            http_client=http_client,
        )
        self.chat = AsyncChat(self._transport)
        self.files = AsyncFiles(self._transport)
        self.runs = AsyncRuns(self._transport)
        self.skills = AsyncSkills(self._transport)
        self.specialists = AsyncSpecialists(self._transport)
        self.exec_plan = AsyncExecPlan(self._transport)
        self.conversations = AsyncConversations(self._transport)
        self.memory = AsyncMemory(self._transport)
        self.apps = AsyncApps(self._transport)
        self.openai = AsyncOpenAI(self._transport)

    def __repr__(self) -> str:
        return "AsyncIskra()"

    async def aclose(self) -> None:
        await self._transport.close()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()
