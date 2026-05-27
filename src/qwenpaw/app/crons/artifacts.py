# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any


def extract_text_from_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    text = block.get("text")
                    if text:
                        parts.append(str(text))
            elif isinstance(block, str) and block.strip():
                parts.append(block.strip())
        return "\n".join(parts).strip()
    if content is None:
        return ""
    return str(content).strip()


def extract_last_assistant_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") != "assistant":
            continue
        text = extract_text_from_message_content(message.get("content"))
        if text:
            return text
    return ""
