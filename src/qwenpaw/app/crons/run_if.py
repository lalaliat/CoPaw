# -*- coding: utf-8 -*-
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from qwenpaw.utils.command_runner import run_command_async

from .models import RunIfSpec

RunIfDecision = Literal["run", "skip", "error"]


def _shell_command_argv(command: str) -> list[str]:
    if os.name == "nt":
        return ["cmd", "/D", "/S", "/C", command]
    return ["sh", "-c", command]


async def evaluate_run_if(
    spec: RunIfSpec,
    *,
    workspace_dir: Path,
) -> tuple[RunIfDecision, str]:
    """Evaluate a ``run_if`` shell command in the agent workspace.

    Exit-code contract (aligned with ``run_if`` naming):

    - ``0`` → skip execution (condition not met)
    - non-zero → run execution (condition met)
    - launch/timeout failures → error
    """
    command = (spec.command or "").strip()
    if not command:
        return "error", "run_if:empty_command"

    if not workspace_dir.is_dir():
        return "error", "run_if:workspace_not_found"

    try:
        result = await run_command_async(
            _shell_command_argv(command),
            cwd=workspace_dir,
            timeout=spec.timeout_seconds,
            check=False,
        )
    except Exception as exc:  # pylint: disable=broad-except
        return "error", f"run_if:execution_failed:{exc!r}"

    if result.returncode == 0:
        detail = result.combined_output.strip()
        reason = "run_if:exit_0"
        if detail:
            reason = f"{reason}:{detail[:200]}"
        return "skip", reason

    return "run", ""
