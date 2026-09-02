#!/usr/bin/env python3
"""Build and validate the browser-only GitHub Pages bundle.

The course project keeps its Pages source in ``web/pages/`` when a shared
frontend is available.  Until that directory exists, the checked-in ``docs/``
bundle is the self-contained fallback.  The script deliberately validates the
staged files before copying them: a Pages deployment must not depend on a
Python process, an API endpoint, or an absolute asset URL.

Examples (run from the repository root)::

    python scripts/build_pages.py
    python scripts/build_pages.py --source web/pages
    python scripts/build_pages.py --check

The default command is idempotent.  It only copies regular static files and
creates the ``.nojekyll`` marker; it never touches the local JSON database or
the Flask application.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "docs"
STATIC_CANDIDATES = (
    ROOT / "web" / "pages",
    ROOT / "web" / "static-pages",
)
# Markdown and text files may document API examples or contain links.  They
# are useful repository documentation, but are not browser-executed Pages
# assets and should not be checked for browser network dependencies.
TEXT_EXTENSIONS = {".html", ".htm", ".css", ".js", ".json", ".svg"}
REQUIRED_FILES = (Path("index.html"), Path("assets/styles.css"), Path("assets/app.js"))

# These checks are intentionally simple and conservative.  They catch the
# common accidental conversion of a browser-only bundle back to a server app
# without trying to parse JavaScript or CSS.
FORBIDDEN_PATTERNS = (
    re.compile(r"\bfetch\s*\(", re.IGNORECASE),
    re.compile(r"\bXMLHttpRequest\b", re.IGNORECASE),
    re.compile(r"\baxios\b", re.IGNORECASE),
    re.compile(r"(?:^|[\"'`])\s*/api(?:[/\"'`]|$)", re.IGNORECASE | re.MULTILINE),
    re.compile(r"\bhttps?://", re.IGNORECASE),
)
ABSOLUTE_HTML_ASSET = re.compile(r"(?:src|href)\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)


class BundleError(RuntimeError):
    """Raised when the staged Pages bundle cannot be published safely."""


def choose_source(explicit: Path | None, output: Path) -> Path:
    if explicit is not None:
        source = explicit if explicit.is_absolute() else ROOT / explicit
        return source.resolve()
    for candidate in STATIC_CANDIDATES:
        if candidate.is_dir():
            return candidate.resolve()
    # The repository starts with a complete standalone Pages bundle.  Keeping
    # docs as the fallback means the command is useful before web/ is created.
    return output.resolve()


def iter_files(directory: Path):
    for path in sorted(directory.rglob("*")):
        if path.is_file() and not path.is_symlink():
            yield path


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise BundleError(f"静态文件必须使用 UTF-8：{path}") from exc


def validate_bundle(directory: Path) -> list[Path]:
    if not directory.is_dir():
        raise BundleError(f"找不到静态源目录：{directory}")
    missing = [str(relative) for relative in REQUIRED_FILES if not (directory / relative).is_file()]
    if missing:
        raise BundleError("静态源缺少必要文件：" + ", ".join(missing))

    files = list(iter_files(directory))
    if not files:
        raise BundleError(f"静态源目录为空：{directory}")

    problems: list[str] = []
    for path in files:
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        content = read_text(path)
        scan_content = content
        if path.suffix.lower() == ".svg":
            # SVG requires this XML namespace declaration.  It is not a
            # remote asset request and should not trip the URL guard.
            scan_content = re.sub(
                r"xmlns\s*=\s*[\"']https?://www\.w3\.org/2000/svg[\"']",
                "",
                scan_content,
                flags=re.IGNORECASE,
            )
        for pattern in FORBIDDEN_PATTERNS:
            if pattern.search(scan_content):
                problems.append(f"{path.relative_to(directory)} 命中禁止的服务器/远程依赖：{pattern.pattern}")
        if path.suffix.lower() in {".html", ".htm"}:
            for asset in ABSOLUTE_HTML_ASSET.findall(content):
                if asset.startswith(("/", "//")):
                    problems.append(f"{path.relative_to(directory)} 使用了绝对资源路径：{asset}")
    if problems:
        raise BundleError("\n".join(problems))
    return files


def copy_bundle(source: Path, output: Path) -> int:
    """Copy a validated source into output without deleting unrelated files."""

    output.mkdir(parents=True, exist_ok=True)
    copied = 0
    for source_file in iter_files(source):
        relative = source_file.relative_to(source)
        target = output / relative
        # The fallback source is docs itself; avoid copying a file onto itself.
        if source_file.resolve() == target.resolve():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target)
        copied += 1
    marker = output / ".nojekyll"
    marker.write_text("Static bundle generated by scripts/build_pages.py.\n", encoding="utf-8")
    return copied


def stage_and_validate(source: Path) -> list[Path]:
    """Validate through a temporary copy, catching broken source traversal."""

    with tempfile.TemporaryDirectory(prefix="campusflow-pages-") as temporary:
        staging = Path(temporary) / "bundle"
        shutil.copytree(source, staging, symlinks=False)
        return validate_bundle(staging)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="构建并检查 CampusFlow GitHub Pages 静态演示")
    parser.add_argument("--source", type=Path, help="静态源目录，默认优先使用 web/pages/，否则使用 docs/")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="发布目录，默认 docs/")
    parser.add_argument("--check", action="store_true", help="只检查源文件，不写入发布目录")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    output = args.output if args.output.is_absolute() else ROOT / args.output
    output = output.resolve()
    source = choose_source(args.source, output)
    if not source.exists():
        raise BundleError(f"找不到静态源目录：{source}")

    # Validate the exact source before changing docs.  A second validation of
    # the output catches copying mistakes and makes --check useful in CI.
    files = validate_bundle(source)
    if args.check:
        print(f"Pages 静态检查通过：{source}（{len(files)} 个文件，无服务器请求）")
        return 0

    copied = copy_bundle(source, output)
    output_files = validate_bundle(output)
    print(f"Pages 构建完成：{output}（复制 {copied} 个文件，验证 {len(output_files)} 个文件）")
    print("发布目录只包含相对资源、HTML/CSS/JS 和浏览器 localStorage 数据适配器。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BundleError as error:
        print(f"Pages 构建失败：{error}", file=sys.stderr)
        raise SystemExit(2)
