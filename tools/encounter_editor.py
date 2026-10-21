#!/usr/bin/env python3
"""인카운터 시각적 노드 편집기 (Encounter Node Editor) 로컬 서버

실행 방법:
    python tools/encounter_editor.py
또는 tools/run_editor.bat 더블 클릭

브라우저가 자동으로 열리며, 기존 인카운터 목록을 불러오고 바로 저장할 수 있습니다.
"""
import glob
import http.server
import json
import os
import socketserver
import subprocess
import sys
import urllib.parse
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML_FILE = ROOT / "tools" / "encounter_editor.html"
PORT = 8234


class EditorHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/" or parsed.path == "/editor":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_FILE.read_bytes())
            return

        if parsed.path == "/api/assets":
            def get_ids(pat):
                res = []
                for p in glob.glob(str(ROOT / pat), recursive=True):
                    res.append(Path(p).stem)
                return sorted(list(set(res)))

            def get_files(pat):
                res = []
                for p in glob.glob(str(ROOT / pat), recursive=True):
                    res.append(os.path.basename(p))
                return sorted(list(set(res)))

            assets = {
                "cards": get_ids("cards/*.json") + get_ids("expension_pack/**/cards/*.json") + get_ids("expansion_pack/**/cards/*.json"),
                "enemies": get_ids("enemy/**/*.json") + get_ids("expension_pack/**/enemy/**/*.json") + get_ids("expansion_pack/**/enemy/**/*.json"),
                "passives": get_ids("passives/*.json") + get_ids("expension_pack/**/passives/*.json") + get_ids("expansion_pack/**/passives/*.json"),
                "gadgets": get_ids("gadgets/*.json"),
                "schedule": get_ids("encounter_normal/schedule/**/*.json") + get_ids("expension_pack/**/encounter_normal/schedule/**/*.json"),
                "players": get_ids("player/char/*.json"),
                "mus": get_files("mus/*"),
                "sfx": get_files("sfx/*"),
            }
            # Remove duplicates
            for k in assets:
                assets[k] = sorted(list(set(assets[k])))
            self.send_json({"ok": True, "assets": assets})
            return

        if parsed.path == "/api/list":
            encounters = []
            patterns = [
                "encounter_normal/**/*.json",
                "encounter_main/**/*.json",
                "expension_pack/**/encounter_normal/**/*.json",
                "expansion_pack/**/encounter_normal/**/*.json",
            ]
            seen_paths = set()
            for pat in patterns:
                for p_str in glob.glob(str(ROOT / pat), recursive=True):
                    rel = os.path.relpath(p_str, ROOT).replace("\\", "/")
                    if rel in seen_paths:
                        continue
                    seen_paths.add(rel)
                    try:
                        with open(p_str, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        if isinstance(data, dict) and "nodes" in data:
                            encounters.append({
                                "path": rel,
                                "id": data.get("id", Path(rel).stem),
                                "start": data.get("start", "begin"),
                                "node_count": len(data.get("nodes", {})),
                            })
                    except Exception:
                        pass

            encounters.sort(key=lambda x: x["path"])
            self.send_json({"ok": True, "encounters": encounters})
            return

        if parsed.path == "/api/load":
            query = urllib.parse.parse_qs(parsed.query)
            rel_path = query.get("path", [None])[0]
            if not rel_path:
                self.send_json({"ok": False, "error": "경로(path)가 지정되지 않았습니다."}, status=400)
                return

            file_path = (ROOT / rel_path).resolve()
            if not file_path.exists() or not str(file_path).startswith(str(ROOT)):
                self.send_json({"ok": False, "error": "파일을 찾을 수 없습니다."}, status=404)
                return

            try:
                data = json.loads(file_path.read_text(encoding="utf-8"))
                self.send_json({"ok": True, "data": data, "path": rel_path})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, status=500)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/save":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body.decode("utf-8"))
                rel_path = payload.get("path")
                data = payload.get("data")
                rebuild = payload.get("rebuild", True)

                if not rel_path or not data:
                    self.send_json({"ok": False, "error": "path 및 data가 필요합니다."}, status=400)
                    return

                file_path = (ROOT / rel_path).resolve()
                if not str(file_path).startswith(str(ROOT)):
                    self.send_json({"ok": False, "error": "프로젝트 외부 경로는 저장할 수 없습니다."}, status=403)
                    return

                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

                rebuild_output = ""
                if rebuild:
                    build_script = ROOT / "tools" / "build_web.py"
                    if build_script.exists():
                        res = subprocess.run([sys.executable, str(build_script)], capture_output=True, text=True, cwd=str(ROOT))
                        rebuild_output = res.stdout

                self.send_json({"ok": True, "message": f"{rel_path} 저장 완료", "rebuild": rebuild_output})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, status=500)
            return

        self.send_json({"ok": False, "error": "지원하지 않는 엔드포인트입니다."}, status=404)

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = PORT
    for attempt in range(5):
        try:
            with socketserver.TCPServer(("", port), EditorHandler) as httpd:
                url = f"http://localhost:{port}"
                print("==================================================")
                print(f"  인카운터 시각적 노드 편집기 서버 가동!")
                print(f"  주소: {url}")
                print(f"  종료하려면 Ctrl+C를 누르세요.")
                print("==================================================")
                webbrowser.open(url)
                httpd.serve_forever()
                break
        except OSError:
            port += 1


if __name__ == "__main__":
    main()

