"""Live SDK scenarios; configuration arrives over stdin, results contain no keys."""

import asyncio
import json
import os
import sys
import time
import uuid

from iskra_sdk import APIError, AsyncIskra, Iskra, RequestOptions, UploadFile


def run(config):
    report = {"scenarios": {}, "cleanup": [], "memory_folders": []}
    conversations = []
    runs = []
    marker = config["marker"]
    credentials = {"api_key": config["apiKey"], "base_url": config["baseUrl"]}

    def passed(name, **details):
        report["scenarios"][name] = {"status": "pass", **details}

    def journal(resource):
        if config.get("journalPath"):
            descriptor = os.open(config["journalPath"], os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            with os.fdopen(descriptor, "a") as output:
                output.write(json.dumps(resource) + "\n")

    with Iskra(**credentials) as client:
        try:
            defaults = client.exec_plan.defaults()
            assert isinstance(defaults["version"], int)
            assert {"model", "skills", "specialist"} <= defaults["pins"].keys()
            assert isinstance(client.skills.list()["skills"], list)
            assert isinstance(client.specialists.list()["specialists"], list)
            assert isinstance(client.openai.models()["data"], list)
            assert isinstance(client.memory.browse({"limit": 10})["entries"], list)
            collections = client.memory.collections()["collections"]
            for collection in collections[:1]:
                assert isinstance(client.memory.collection_members(collection["id"])["members"], list)
            passed("sync_catalogs", collection_members=bool(collections))

            with Iskra(api_key=config["restrictedApiKey"], base_url=config["baseUrl"]) as restricted:
                for operation in (
                    restricted.memory.browse,
                    lambda: restricted.files.upload([UploadFile("denied.txt", b"denied")]),
                ):
                    try:
                        operation()
                    except APIError as error:
                        assert error.status_code == 403
                        assert config["restrictedApiKey"] not in str(error) + repr(error)
                    else:
                        raise AssertionError("A key without the scope was accepted")
            passed("scope_errors")

            try:
                client.conversations.context(str(uuid.uuid4()))
            except APIError as error:
                assert error.status_code == 404
            else:
                raise AssertionError("A missing conversation was readable")
            passed("missing_resource")

            conversation = client.conversations.create({"ttl_seconds": 1800})
            cid = conversation["conversation_id"]
            conversations.append(cid)
            journal({"kind": "conversation", "id": cid})
            assert "workspace" in client.conversations.context(cid)
            directory = config.get("directoryId")
            if directory:
                selected = client.conversations.set_workspace(cid, directory)
                assert selected["workspace"]["directory_id"] == directory
                client.conversations.clear_workspace(cid)
                refs = client.conversations.add_memory_ref(
                    cid, {"locator": {"directory_id": directory}, "access_mode": "read"}
                )["references"]
                ref = next(r for r in refs if r.get("locator", {}).get("directory_id") == directory)
                updated = client.conversations.update_memory_ref(cid, ref["id"], "write")
                assert next(r for r in updated["references"] if r["id"] == ref["id"])["access_mode"] == "write"
                client.conversations.delete_memory_ref(cid, ref["id"])
                assert all(r["id"] != ref["id"] for r in client.conversations.context(cid)["references"])
                passed("workspace_and_memory_refs")

                folder = client.memory.create_folder(directory, marker)
                report["memory_folders"].append({"id": folder["id"], "directory_id": directory})
                journal({"kind": "memory_folder", "id": folder["id"], "directory_id": directory})
                uploaded = client.memory.upload(
                    directory, UploadFile("marker.txt", marker.encode(), "text/plain"),
                    path=marker + "/marker.txt", conflict_policy="create",
                )
                with client.memory.download(uploaded["file"]["id"], directory_id=directory) as response:
                    assert response.read() == marker.encode()
                entries = client.memory.browse({"directory_id": directory, "folder_id": folder["id"]})["entries"]
                assert any(e["locator"].get("file_id") == uploaded["file"]["id"] for e in entries)
                passed("memory_folder_upload_download")
            else:
                report["scenarios"]["workspace_and_memory_refs"] = {"status": "skip", "reason": "No writable Memory directory supplied"}
                report["scenarios"]["memory_folder_upload_download"] = {"status": "skip", "reason": "No writable Memory directory supplied"}

            files = client.files.upload(
                [UploadFile("python-marker.txt", marker.encode(), "text/plain")], conversation_id=cid,
            )
            request = {
                "conversation_id": cid,
                "message": "Прочитай python-marker.txt и ответь только маркером из файла.",
                "files": [{"id": file["id"]} for file in files["files"]],
                "iskra_exec": {"complexity": "simple", "skills": defaults["options"]["mandatory_bundles"]},
            }
            options = RequestOptions(idempotency_key=marker)
            created = client.runs.create(request, options=options)
            runs.append(created["run_id"])
            journal({"kind": "run", "id": created["run_id"], "conversation_id": cid})
            assert client.runs.create(request, options=options)["run_id"] == created["run_id"]
            passed("sync_upload_async_run_replay")

            async def follow():
                async with AsyncIskra(**credentials, timeout_seconds=180) as asynchronous:
                    async with asyncio.timeout(240):
                        events = []
                        async with asynchronous.runs.events(created["run_id"]) as stream:
                            async for event in stream:
                                events.append(event)
                        assert events[-1].event == "completed", "run_terminal_" + events[-1].event
                        result = await asynchronous.runs.wait(created["run_id"], timeout_seconds=180)
                        assert result["status"] == "completed", (result.get("error") or {}).get("code")
                        assert marker in result["result"]["answer"]
                        async with asynchronous.files.download(cid, "python-marker.txt") as response:
                            assert await response.aread() == marker.encode()
                        # A completed run must replay its terminal state even after the last cursor.
                        replay = []
                        async with asynchronous.runs.events(created["run_id"], after=result["next_after"]) as stream:
                            async for event in stream:
                                replay.append(event)
                        assert replay[-1].event == "completed"
                        return len(events)

            passed("async_sse_wait_download_resume", events=asyncio.run(follow()))
        except Exception as error:
            report["failure"] = {"type": type(error).__name__}
            if isinstance(error, APIError):
                report["failure"].update(status_code=error.status_code, code=error.code)
            elif isinstance(error, AssertionError) and error.args:
                report["failure"]["check"] = str(error.args[0])[:160]
        finally:
            for rid in reversed(runs):
                try:
                    snapshot = client.runs.get(rid)
                    if snapshot["status"] in {"queued", "running"}:
                        client.runs.cancel(rid)
                        client.runs.wait(rid, timeout_seconds=15)
                except APIError as error:
                    if error.status_code not in {404, 409, 410}:
                        report["cleanup"].append({"run_id": rid, "status": "fail", "type": type(error).__name__})
                except Exception as error:
                    report["cleanup"].append({"run_id": rid, "status": "fail", "type": type(error).__name__})
            for cid in reversed(conversations):
                try:
                    deadline = time.monotonic() + 10
                    while True:
                        try:
                            client.chat.delete(cid)
                            break
                        except APIError as error:
                            if error.status_code != 409 or error.code != "generation_in_progress" or time.monotonic() >= deadline:
                                raise
                            time.sleep(0.2)
                    report["cleanup"].append({"conversation_id": cid, "status": "pass"})
                except Exception as error:
                    report["cleanup"].append({"conversation_id": cid, "status": "fail", "type": type(error).__name__})
    return report


if __name__ == "__main__":
    if not __debug__:
        print(json.dumps({"failure": {"type": "AssertionsDisabled"}, "scenarios": {}, "cleanup": []}))
        sys.exit(1)
    started = time.monotonic()
    config = json.load(sys.stdin)
    report = run(config)
    report["elapsed_seconds"] = round(time.monotonic() - started, 2)
    serialized = json.dumps(report)
    for secret in (config["apiKey"], config["restrictedApiKey"]):
        serialized = serialized.replace(secret, "[REDACTED]")
    print(serialized)
    sys.exit(1 if "failure" in report or any(c["status"] != "pass" for c in report["cleanup"]) else 0)
