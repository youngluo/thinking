#!/usr/bin/env python3
"""Validate objective Markdown constraints required by the polish skill."""

from __future__ import annotations

import re
import sys
from pathlib import Path


FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
LIST_RE = re.compile(r"^(\s*)(?:[-+*]|\d+[.)])\s+(.+?)\s*$")
NUMBERED_TITLE_RE = re.compile(
    r"^(?:\d+(?:\.\d+)*(?:[.、．)）]\s*|\s+|$)|"
    r"[一二三四五六七八九十百]+(?:[、.．)）]\s*|\s+|$)|"
    r"[（(][一二三四五六七八九十百\d]+[）)]|第[一二三四五六七八九十百\d]+[章节部分])\s*"
)
DASH_CHARACTERS = ("—", "–", "―")


def fail(errors: list[str], path: Path, line: int, message: str) -> None:
    errors.append(f"{path}:{line}: {message}")


def validate_title(errors: list[str], path: Path, line: int, title: str) -> None:
    value = title.strip().strip("\"'")
    if NUMBERED_TITLE_RE.match(value):
        fail(errors, path, line, "标题不能带序号")
    if "`" in value:
        fail(errors, path, line, "标题不能使用反引号")
    if ":" in value or "：" in value:
        fail(errors, path, line, "标题不能使用冒号")
    if any(character in value for character in DASH_CHARACTERS):
        fail(errors, path, line, "标题不能使用破折号")


def visible_lines(lines: list[str]) -> tuple[list[tuple[int, str]], bool]:
    visible: list[tuple[int, str]] = []
    fence_char = ""
    fence_size = 0

    for number, line in enumerate(lines, 1):
        match = FENCE_RE.match(line)
        if match:
            marker = match.group(1)
            if not fence_char:
                fence_char = marker[0]
                fence_size = len(marker)
            elif marker[0] == fence_char and len(marker) >= fence_size:
                fence_char = ""
                fence_size = 0
            continue
        if not fence_char:
            visible.append((number, line))

    return visible, bool(fence_char)


def validate_lists(errors: list[str], path: Path, lines: list[tuple[int, str]]) -> None:
    group: list[tuple[int, str]] = []
    group_indent: int | None = None

    def flush() -> None:
        nonlocal group, group_indent
        if len(group) < 2:
            group = []
            group_indent = None
            return
        for line, text in group[:-1]:
            if not text.endswith("；"):
                fail(errors, path, line, "列表非末项应以中文分号结尾")
        line, text = group[-1]
        if not text.endswith("。"):
            fail(errors, path, line, "列表末项应以中文句号结尾")
        group = []
        group_indent = None

    for number, line in lines:
        match = LIST_RE.match(line)
        if not match:
            if line.strip():
                flush()
            continue
        indent = len(match.group(1).replace("\t", "    "))
        text = match.group(2).strip()
        if group_indent is None or indent == group_indent:
            group_indent = indent
            group.append((number, text))
        else:
            flush()
            group_indent = indent
            group.append((number, text))
    flush()


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    visible, unclosed_fence = visible_lines(lines)

    if unclosed_fence:
        fail(errors, path, len(lines), "代码围栏没有闭合")

    frontmatter_end = 0
    has_frontmatter_title = False
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                frontmatter_end = index + 1
                break
            title_match = re.match(r"^title:\s*(.+?)\s*$", lines[index])
            if title_match:
                has_frontmatter_title = True
                validate_title(errors, path, index + 1, title_match.group(1))

    previous_heading_level = 1 if has_frontmatter_title else 0
    h1_count = 0
    for number, line in visible:
        if number <= frontmatter_end:
            continue
        if any(character in line for character in DASH_CHARACTERS):
            fail(errors, path, number, "正文不能使用破折号")
        if "其他" in line:
            fail(errors, path, number, "统一使用“其它”")
        heading_match = HEADING_RE.match(line)
        if not heading_match:
            continue
        level = len(heading_match.group(1))
        title = heading_match.group(2).rstrip("#").strip()
        validate_title(errors, path, number, title)
        if level == 1:
            h1_count += 1
            if has_frontmatter_title:
                fail(errors, path, number, "frontmatter 已提供文章标题，正文不能再使用一级标题")
            elif h1_count > 1:
                fail(errors, path, number, "正文只能有一个一级标题")
        if level > 3:
            fail(errors, path, number, "标题层级不能超过三级")
        if previous_heading_level and level > previous_heading_level + 1:
            fail(errors, path, number, "标题层级不能跳级")
        previous_heading_level = level

    body_lines = [(number, line) for number, line in visible if number > frontmatter_end]
    validate_lists(errors, path, body_lines)
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_markdown.py <markdown-file>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"file not found: {path}", file=sys.stderr)
        return 2

    errors = validate(path)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    print(f"validation passed: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
