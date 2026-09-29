#!/usr/bin/env python3
"""Build dist/app-store-release-notes.zip from the canonical skill files."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "app-store-release-notes.zip"
PACKAGE_ROOT = "app-store-release-notes"
INCLUDE = [
    ROOT / "README.md",
    ROOT / "SKILL.md",
    ROOT / "agents",
    ROOT / "references",
    ROOT / "scripts",
]


def included_files():
    for entry in INCLUDE:
        if entry.is_file():
            yield entry
            continue
        for path in sorted(entry.rglob("*")):
            if path.is_file() and path.name != ".DS_Store" and "__pycache__" not in path.parts:
                yield path


def add_file(archive: ZipFile, path: Path) -> None:
    relative = path.relative_to(ROOT).as_posix()
    info = ZipInfo(f"{PACKAGE_ROOT}/{relative}")
    info.date_time = (2026, 9, 29, 0, 0, 0)
    info.compress_type = ZIP_DEFLATED
    info.external_attr = (path.stat().st_mode & 0xFFFF) << 16
    archive.writestr(info, path.read_bytes())


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".zip.tmp")
    with ZipFile(temporary, "w") as archive:
        for path in included_files():
            add_file(archive, path)
    temporary.replace(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
