#!/usr/bin/env python3
"""Disposable CI fixture for the inline HTTP probe's fail-closed cases."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import sys
import time


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if sys.argv[1] == "timeout":
            time.sleep(8)
        self.send_response(503 if sys.argv[1] == "503" else 404)
        self.end_headers()

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("404", "503", "timeout"):
        raise SystemExit("404|503|timeout required")
    HTTPServer(("127.0.0.1", 3000), Handler).serve_forever()
