#!/usr/bin/env python3
"""게임 데이터(JSON)를 웹 버전이 읽는 web/data/bundle.json 하나로 묶습니다.

카드/적/인카운터 등을 추가하거나 고친 뒤에는 이 스크립트를 다시 실행하세요.
    python tools/build_web.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "bundle.json"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def by_stem(folder, recursive=False):
    """폴더의 JSON을 {파일명(확장자 제외): 데이터} 로 읽습니다. 파일명이 id입니다."""
    result = {}
    if not folder.exists():
        return result
    files = folder.rglob("*.json") if recursive else folder.glob("*.json")
    for f in sorted(files):
        data = load(f)
        if isinstance(data, dict):
            if recursive and f.parent != folder:
                data["_dir"] = f.parent.name  # 하위 폴더(예: dummy_its_a_dummy) 표시
            result[f.stem] = data
    return result


def encounters_by_id(folder):
    result = {}
    for f in sorted(folder.glob("*.json")):
        data = load(f)
        if data and "id" in data:
            result[data["id"]] = data
    return result


def main():
    normal = ROOT / "encounter_normal"
    main_root = ROOT / "encounter_main"

    special = {}
    if normal.exists():
        for folder in sorted(normal.iterdir()):
            if folder.is_dir() and folder.name not in ("common", "schedule"):
                special[folder.name] = [load(f) for f in sorted(folder.glob("*.json"))]

    stories = {}
    if main_root.exists():
        for folder in sorted(main_root.iterdir()):
            if folder.is_dir():
                stories[folder.name] = encounters_by_id(folder)

    bundle = {
        "cards": by_stem(ROOT / "cards"),
        "enemies": by_stem(ROOT / "enemy", recursive=True),
        "allies": by_stem(ROOT / "ally"),
        "passives": by_stem(ROOT / "passives"),
        "status": by_stem(ROOT / "status"),
        "panics": by_stem(ROOT / "panics"),
        "gadgets": by_stem(ROOT / "gadgets"),
        "players": by_stem(ROOT / "player" / "char"),
        "stories": stories,
        "common": [load(f) for f in sorted((normal / "common").glob("*.json"))] if (normal / "common").exists() else [],
        "special": special,
        "schedule": by_stem(normal / "schedule"),
        "profile_default": load(ROOT / "player" / "profile.json") if (ROOT / "player" / "profile.json").exists() else {},
        "credits": load(ROOT / "credits.json") if (ROOT / "credits.json").exists() else {},
        "audio": {
            "mus": sorted(p.name for p in (ROOT / "mus").glob("*") if p.is_file()),
            "sfx": sorted(p.name for p in (ROOT / "sfx").glob("*") if p.is_file()),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {k: len(v) for k, v in bundle.items() if isinstance(v, (dict, list))}
    print(f"web/data/bundle.json 생성 ({OUT.stat().st_size // 1024} KB)")
    print(counts)


if __name__ == "__main__":
    main()
