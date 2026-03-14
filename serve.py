"""Simple local HTTP server for Web Bluetooth development.

Web Bluetooth requires HTTPS or localhost. This serves on localhost.
Usage: python serve.py [port]
"""

import http.server
import sys
import os
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

os.chdir(os.path.dirname(os.path.abspath(__file__)))

handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({
    ".js": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
})

server = http.server.HTTPServer(("localhost", PORT), handler)
url = f"http://localhost:{PORT}"
print(f"Serving at {url}")
print("Press Ctrl+C to stop\n")

webbrowser.open(url)

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
    server.server_close()
