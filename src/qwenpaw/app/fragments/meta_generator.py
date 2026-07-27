# -*- coding: utf-8 -*-
"""Auto-generate fragment metadata via the active LLM.

Mirrors the title_generator.py pattern: build a small prompt,
call the active model, parse structured output.
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Optional

from qwenpaw.exceptions import AppBaseException

if TYPE_CHECKING:
    from ..workspace import Workspace

logger = logging.getLogger(__name__)

META_PROMPT = (
    "You are a research assistant that extracts structured"
    " metadata from text fragments.\n"
    "Given a text snippet captured during a conversation,"
    " generate metadata in JSON format.\n"
    "\n"
    "Text snippet:\n"
    "{source_text}\n"
    "\n"
    "Return ONLY a valid JSON object with these fields:\n"
    '- "surface": A concise summary in ≤30 characters'
    " (same language as the text)\n"
    '- "gist": A one-sentence distillation of the core'
    " idea\n"
    '- "topics": An array of 2-4 topic tags (short,'
    " lowercase, same language as text)\n"
    '- "stance": One of "insight", "question", "analogy",'
    ' "todo", "reference"\n'
    '- "spark": Why this might be interesting or worth'
    " revisiting (1 sentence, optional)\n"
    "\n"
    "Reply with the JSON object only, no markdown fences."
)

MAX_INPUT_CHARS = 1000


async def generate_fragment_meta(
    workspace: "Workspace",
    source_text: str,
) -> Optional[dict]:
    """Generate fragment metadata using the active model.

    Returns a dict with keys: surface, gist, topics, stance, spark.
    Returns None if generation fails.
    """
    text = (source_text or "").strip()
    if not text:
        return None
    if len(text) > MAX_INPUT_CHARS:
        text = text[:MAX_INPUT_CHARS]

    try:
        from ...agents.model_factory import create_model_and_formatter
        from ...config.config import load_agent_config

        try:
            load_agent_config(workspace.agent_id)
        except (ValueError, AppBaseException):
            logger.debug("Fragment meta generation skipped: no agent config")
            return None

        try:
            model, _ = create_model_and_formatter(
                agent_id=workspace.agent_id,
            )
        except (ValueError, AppBaseException):
            logger.debug("Fragment meta generation skipped: no model")
            return None

        from agentscope.message import Msg, TextBlock
        from qwenpaw.utils.model_response import consume_model_response
        import asyncio

        prompt = META_PROMPT.format(source_text=text)
        messages = [
            Msg(
                name="system",
                role="system",
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "You are a helpful metadata"
                            " extraction assistant."
                        ),
                    ),
                ],
            ),
            Msg(
                name="user",
                role="user",
                content=[TextBlock(type="text", text=prompt)],
            ),
        ]

        raw = await asyncio.wait_for(
            consume_model_response(model, messages),
            timeout=30,
        )

        raw = raw.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(
                lines[1:-1] if lines[-1].strip() == "```" else lines[1:],
            )

        meta = json.loads(raw)
        result = {}
        if isinstance(meta.get("surface"), str):
            result["surface"] = meta["surface"][:30]
        if isinstance(meta.get("gist"), str):
            result["gist"] = meta["gist"]
        if isinstance(meta.get("topics"), list):
            result["topics"] = [str(t) for t in meta["topics"][:4]]
        if isinstance(meta.get("stance"), str) and meta["stance"] in (
            "insight",
            "question",
            "analogy",
            "todo",
            "reference",
        ):
            result["stance"] = meta["stance"]
        if isinstance(meta.get("spark"), str):
            result["spark"] = meta["spark"]
        return result

    except json.JSONDecodeError:
        logger.debug("Fragment meta generation: invalid JSON from model")
        return None
    except Exception:
        logger.exception("Fragment meta generation failed")
        return None
