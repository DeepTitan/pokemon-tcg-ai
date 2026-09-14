"""Measure a locally saved replay with fake AWS; optionally serve the built viewer.

python3 infrastructure/aws/tests/benchmark_shared_replay.py payload.json [--serve 4319]
No upload, real AWS client, credentials, or outbound requests are used by this server.
Browser artwork/font requests retain the viewer's normal behavior.
"""
import argparse
import base64
import gzip
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import statistics
import time

from test_shared_replay import app, Objects, Table, decode


def measure(call, count=9):
    timings = []
    for _ in range(count):
        start = time.perf_counter()
        call()
        timings.append((time.perf_counter() - start) * 1000)
    return round(statistics.median(timings), 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("payload", type=Path)
    parser.add_argument("--serve", type=int)
    args = parser.parse_args()
    original = json.loads(args.payload.read_text())
    review = original["review"]
    app.matches, app.shares, app.s3 = Table("deviceId", "matchId"), Table("shareId"), Objects()
    device = "local-only-no-uploads"
    share_id = "local-shared-replay-test01"
    source = app.s3.put_object(Key="local-source.json.gz", Body=gzip.compress(json.dumps(review).encode()))
    item = {**original.get("summary", {}), "deviceId": device, "matchId": review["id"],
            "objectKey": "local-source.json.gz", "objectVersionId": source["VersionId"],
            "reducerVersion": original["reducerVersion"], "updatedAt": original.get("updatedAt"),
            "shareId": share_id}
    app.matches.put_item(Item=item)
    app.shares.put_item(Item={"shareId": share_id, "deviceId": device, "matchId": review["id"]})
    expected = {"review": review, "summary": app.public_summary(item),
                "reducerVersion": item["reducerVersion"], "updatedAt": item["updatedAt"]}
    assert expected == original, "The complete public response must remain unchanged"
    start = time.perf_counter()
    app.share_match(device, review["id"], {})
    prep_ms = (time.perf_counter() - start) * 1000
    prepared = app.get_shared_match(share_id)
    assert decode(prepared) == expected
    assert decode(prepared)["review"] == original["review"]

    def old_read():
        return app.compressed_response(200, {**expected, "review": app.stored_review(item)})

    assert decode(old_read()) == decode(prepared)
    print(json.dumps({
        "scope": "local CPU only; in-memory AWS fakes, not production network latency",
        "frames": len(review["turns"]), "decodedBytes": len(json.dumps(expected, ensure_ascii=False, separators=(",", ":")).encode()),
        "compressedBytes": len(base64.b64decode(prepared["body"])),
        "sharePreparationMs": round(prep_ms, 3), "legacyReadMedianMs": measure(old_read),
        "preparedReadMedianMs": measure(lambda: app.get_shared_match(share_id)),
        "revalidatedReadMedianMs": measure(lambda: app.get_shared_match(share_id, request_headers={"if-none-match": prepared["headers"]["etag"]})),
        "completeReplayEqual": True,
    }, indent=2), flush=True)
    if not args.serve:
        return

    root = Path(__file__).resolve().parents[3] / "landing/dist"
    if (not (root / "shared-replay.html").is_file()
            or not any((root / "tracker-assets/card-catalog").glob("*.json"))
            or not (root / "tracker-assets/card-art").is_dir()):
        raise RuntimeError("Build the complete landing viewer and card assets before browser verification")
    class Handler(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def __init__(self, *params, **kwargs):
            super().__init__(*params, directory=str(root), **kwargs)

        def do_GET(self):
            if self.path == f"/v1/shares/{share_id}":
                result = app.get_shared_match(share_id, request_headers=dict(self.headers))
                body = base64.b64decode(result["body"]) if result.get("isBase64Encoded") else result["body"].encode()
                self.send_response(result["statusCode"])
                for key, value in result["headers"].items():
                    self.send_header(key, value)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif self.path == f"/trace/{share_id}":
                # Test-only timing mark, injected before the production script.
                instrument = "<script>new MutationObserver((_,o)=>{if(document.querySelector('[aria-label=\"Match board\"]')){performance.mark('trace-board-ready');o.disconnect();}}).observe(document.documentElement,{childList:true,subtree:true});</script>"
                body = (root / "shared-replay.html").read_text().replace("</head>", instrument + "</head>").encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

    print(f"Local-only viewer: http://127.0.0.1:{args.serve}/trace/{share_id}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.serve), Handler).serve_forever()


if __name__ == "__main__":
    main()
