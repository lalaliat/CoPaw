# -*- coding: utf-8 -*-
from __future__ import annotations

import os
from pathlib import Path

from ...utils.command_runner import CommandResult, run_command_async
from .models import ScriptSpec

_SCRIPT_INTERPRETERS: dict[str, str] = {
    "bash": "bash",
    "sh": "sh",
    "python": "python3",
    "python3": "python3",
    "node": "node",
}


class CronScriptError(Exception):
    """Raised when a cron script cannot be prepared or executed."""


def resolve_script_path(path: str) -> Path:
    """Expand and resolve a configured script path."""
    expanded = Path(path.strip()).expanduser()
    return expanded.resolve(strict=False)


def build_script_command(script: ScriptSpec) -> list[str]:
    """Build argv for subprocess from a script spec."""
    script_path = resolve_script_path(script.path)
    if not script_path.is_file():
        raise CronScriptError(f"Script not found: {script_path}")

    args = [str(item) for item in (script.args or [])]
    interpreter = (script.interpreter or "auto").strip().lower()

    if interpreter == "auto":
        if os.access(script_path, os.X_OK):
            return [str(script_path), *args]
        suffix = script_path.suffix.lower()
        if suffix == ".py":
            return ["python3", str(script_path), *args]
        if suffix in (".sh", ".bash"):
            return ["bash", str(script_path), *args]
        if suffix == ".js":
            return ["node", str(script_path), *args]
        return ["bash", str(script_path), *args]

    executable = _SCRIPT_INTERPRETERS.get(interpreter)
    if executable is None:
        raise CronScriptError(f"Unsupported interpreter: {interpreter}")
    return [executable, str(script_path), *args]


def resolve_working_directory(cwd: str | None) -> str | None:
    if not cwd or not cwd.strip():
        return None
    resolved = Path(cwd.strip()).expanduser().resolve(strict=False)
    if not resolved.is_dir():
        raise CronScriptError(f"Working directory not found: {resolved}")
    return str(resolved)


async def run_cron_script(
    script: ScriptSpec,
    *,
    timeout_seconds: int,
) -> CommandResult:
    """Execute one script job and return subprocess output."""
    command = build_script_command(script)
    working_dir = resolve_working_directory(script.cwd)
    return await run_command_async(
        command,
        timeout=timeout_seconds,
        cwd=working_dir,
        check=False,
    )


def truncate_cron_output(text: str, *, limit: int = 4096) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n... (truncated, {len(text)} chars total)"


def build_script_inbox_body(
    *,
    exit_code: int | None,
    stdout: str,
    stderr: str,
    script_path: str,
    error: str | None = None,
) -> str:
    """Format script execution output for Inbox display."""
    lines = [f"Script: {script_path}"]
    if exit_code is not None:
        lines.append(f"Exit code: {exit_code}")
    if error:
        lines.append(f"Error: {error}")
    stdout_text = truncate_cron_output(stdout or "")
    stderr_text = truncate_cron_output(stderr or "")
    lines.append("")
    lines.append("--- stdout ---")
    lines.append(stdout_text or "(empty)")
    if stderr_text.strip():
        lines.append("")
        lines.append("--- stderr ---")
        lines.append(stderr_text)
    return "\n".join(lines)
