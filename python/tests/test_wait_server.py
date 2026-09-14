"""Real HTTPX socket timeout/cleanup regression, without a background SDK worker."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from iskra_sdk import Iskra, WaitTimeoutError


@pytest.mark.parametrize("status", [200, 502])
def test_sync_wait_stops_slow_stream_and_does_not_send_delete(status):
    methods = []
    disconnected = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            methods.append("GET")
            payload = json.dumps(
                {"status": "running", "next_after": 1, "padding": "x" * 100}
            ).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            try:
                for byte in payload:
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(0.005)
            except (BrokenPipeError, ConnectionResetError):
                disconnected.set()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with Iskra(api_key="k", base_url=f"http://127.0.0.1:{server.server_port}") as client:
            start = time.monotonic()
            with pytest.raises(WaitTimeoutError):
                client.runs.wait("r", timeout_seconds=0.07)
            assert time.monotonic() - start < 0.4
        assert disconnected.wait(timeout=1)
        assert methods == ["GET"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)
