#!/usr/bin/env python3
"""
Tiny dashboard for the pre-market reports. Serves on 0.0.0.0:8090:

    /                 latest report (reports/latest.html) plus run history
    /history          JSON list of every saved report
    /reports/<file>   any saved report file (md / json / html)

No dependencies beyond the standard library, no external assets, so it renders
inside the sandboxed preview iframe.
"""

import http.server
import json
import os
import socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "reports")
PORT = 8090


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype="text/html; charset=utf-8", code=200):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0].lstrip("/")
        if path in ("", "index.html"):
            return self.index()
        if path == "history":
            files = sorted(f for f in os.listdir(REPORTS)
                           if f.endswith("-premarket.json")) if os.path.isdir(REPORTS) else []
            out = []
            for f in files:
                try:
                    d = json.load(open(os.path.join(REPORTS, f)))
                    out.append(dict(date=d["date"], score=d["score"], bias=d["bias"],
                                    generated_at=d["generated_at"]))
                except Exception:
                    pass
            return self._send(json.dumps(out[::-1], indent=2), "application/json")
        if path.startswith("reports/"):
            name = os.path.basename(path)
            full = os.path.join(REPORTS, name)
            if os.path.isfile(full) and name.endswith((".html", ".md", ".json")):
                ctype = ("text/html; charset=utf-8" if name.endswith(".html")
                         else "application/json" if name.endswith(".json")
                         else "text/markdown; charset=utf-8")
                return self._send(open(full, "rb").read(), ctype)
        return self._send("not found", code=404)

    def index(self):
        latest = os.path.join(REPORTS, "latest.html")
        body = open(latest).read() if os.path.isfile(latest) else None
        hist = ""
        if os.path.isdir(REPORTS):
            files = sorted((f for f in os.listdir(REPORTS)
                            if f.endswith("-premarket.html")), reverse=True)
            if files:
                items = "\n".join(
                    "<li style='margin:3px 0'><a style='color:#7dd3fc' href='/reports/%s'>%s</a></li>"
                    % (f, f.replace("-premarket.html", "")) for f in files)
                hist = ("<div style='margin-top:22px'><h2 style='font-size:15px;color:#cbd5e1;"
                        "margin:0 0 8px'>Report history</h2><ul style='list-style:none;padding:0;"
                        "margin:0;font-size:13px'>%s</ul></div>" % items)
        if body is None:
            body = ("<body style='font-family:sans-serif;background:#0f172a;color:#e2e8f0;"
                    "padding:40px'>No report yet. The first scan runs at 09:00 IST on the next "
                    "trading day, or on demand with <code>python3 scan.py</code>.</body>")
        body = body.replace("</body>", hist + "</body>") if hist else body
        self._send(body)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as srv:
        print("dashboard on http://0.0.0.0:%d" % PORT, flush=True)
        srv.serve_forever()
