# -*- coding: utf-8 -*-
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Mapping

from qwenpaw.utils.command_runner import run_command_async

from .models import NotifyIfSpec

NotifyIfDecision = Literal["notify", "skip", "error"]


def _shell_command_argv(command: str) -> list[str]:
    if os.name == "nt":
        return ["cmd", "/D", "/S", "/C", command]
    return ["sh", "-c", command]


async def evaluate_notify_if(
    spec: NotifyIfSpec,
    *,
    workspace_dir: Path,
    extra_env: Mapping[str, str] | None = None,
) -> tuple[NotifyIfDecision, str]:
    """Evaluate a ``notify_if`` shell command in the agent workspace.

    Exit-code contract (aligned with ``notify_if`` naming):

    - ``0`` → skip delivery for this run
    - non-zero → deliver per job dispatch / inbox settings
    - launch/timeout failures → error
    """
    command = (spec.command or "").strip()
    if not command:
        return "error", "notify_if:empty_command"

    if not workspace_dir.is_dir():
        return "error", "notify_if:workspace_not_found"

    env = os.environ.copy()
    if extra_env:
        env.update(dict(extra_env))

    try:
        result = await run_command_async(
            _shell_command_argv(command),
            cwd=workspace_dir,
            timeout=spec.timeout_seconds,
            check=False,
            env=env,
        )
    except Exception as exc:  # pylint: disable=broad-except
        return "error", f"notify_if:execution_failed:{exc!r}"

    if result.returncode == 0:
        detail = result.combined_output.strip()
        reason = "notify_if:exit_0"
        if detail:
            reason = f"{reason}:{detail[:200]}"
        return "skip", reason

    return "notify", ""
