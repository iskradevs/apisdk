"""Run with ISKRA_API_KEY, ISKRA_BASE_URL and a local brief.txt.

Requires chat:run, files:read, files:write, memory:read and memory:write.
Set ISKRA_RUN_AS when the complete workflow should use delegation.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import cast
from urllib.parse import unquote, urlsplit

from iskra_sdk import AsyncIskra, RequestOptions, UploadFile
from iskra_sdk.types import ChatResponse


async def main() -> None:
    async with AsyncIskra(
        api_key=os.environ["ISKRA_API_KEY"],
        base_url=os.environ["ISKRA_BASE_URL"],
        run_as=os.environ.get("ISKRA_RUN_AS"),
    ) as client:
        workspace = await client.memory.create_root("Результаты интеграции")
        conversation = await client.conversations.create(
            {"workspace_directory_id": workspace["id"], "memory_refs": [], "ttl_seconds": 3600}
        )
        conversation_id = conversation["conversation_id"]
        with Path("brief.txt").open("rb") as source:
            upload = await client.files.upload(
                [UploadFile("brief.txt", source, "text/plain")],
                conversation_id=conversation_id,
            )
        accepted = await client.runs.create(
            {
                "conversation_id": conversation_id,
                "message": "Прочитай brief.txt. Составь план и сохрани его в answer.md.",
                "files": [{"id": file["id"]} for file in upload["files"]],
            },
            options=RequestOptions(idempotency_key="brief-plan-1"),
        )
        snapshot = await client.runs.wait(accepted["run_id"], timeout_seconds=900)
        print(snapshot["status"], snapshot["result"], snapshot["error"])
        if snapshot["status"] != "completed" or snapshot["result"] is None:
            return
        result = cast(ChatResponse, snapshot["result"])
        for index, artifact in enumerate(result.get("files", [])):
            # The returned URL is interpreted as a path only. Requests continue
            # through the configured SDK origin and encoded path segments.
            marker = f"/api/v1/chat/{conversation_id}/files/"
            download_url = artifact.get("download_url")
            if not download_url:
                continue
            returned_path = urlsplit(download_url).path
            if marker not in returned_path:
                raise ValueError("Unexpected artifact download path")
            artifact_path = unquote(returned_path.split(marker, 1)[1])
            async with client.files.download(conversation_id, artifact_path) as response:
                with Path(f"artifact-{index}.bin").open("wb") as output:
                    async for chunk in response.aiter_bytes():
                        output.write(chunk)
        # Workspace files persist independently of this ephemeral conversation.
        await client.chat.delete(conversation_id)


if __name__ == "__main__":
    asyncio.run(main())
