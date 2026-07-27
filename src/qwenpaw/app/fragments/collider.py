# -*- coding: utf-8 -*-
"""Build collision prompts from selected fragments."""
from __future__ import annotations

from typing import List

from .models import FragmentSpec


def build_collide_prompt(
    fragments: List[FragmentSpec],
    mode: str = "analytical",
) -> str:
    """Build a prompt for the agent to collide fragments."""
    fragment_sections = []
    for i, f in enumerate(fragments, 1):
        topics_str = (
            ", ".join(f"#{t}" for t in f.topics) if f.topics else "(none)"
        )
        section = f"""### Fragment {i}
- **Surface**: {f.surface or '(no summary)'}
- **Gist**: {f.gist or '(no gist)'}
- **Topics**: {topics_str}
- **Type**: {f.stance}
- **Spark**: {f.spark or '(none)'}
- **Original text**:
> {f.source_text}
"""
        fragment_sections.append(section)

    fragments_block = "\n".join(fragment_sections)

    if mode == "creative":
        task_instruction = (
            "Be bold and creative. Even seemingly unrelated"
            " fragments may hide surprising connections."
            " Encourage unconventional leaps of thought."
            " Think like a researcher brainstorming over"
            " coffee — unexpected analogies are welcome."
        )
    else:
        task_instruction = (
            "Be rigorous and analytical. Look for logical"
            " connections, shared underlying patterns, and"
            " complementary perspectives. Focus on connections"
            " that are defensible and could lead to concrete"
            " research."
        )

    return (
        "You are a research idea collision assistant. "
        'The user has captured several "fragment tags" — '
        "short inspirational snippets from different "
        "conversations and contexts. Your job is to find "
        "connections between them and synthesize potential "
        "research ideas.\n"
        "\n"
        "## Fragments to Collide\n"
        "\n"
        f"{fragments_block}\n"
        "\n"
        "## Task\n"
        "\n"
        f"{task_instruction}\n"
        "\n"
        "## Output Format\n"
        "\n"
        "Please structure your response as:\n"
        "\n"
        "### \U0001f517 Discovered Connections\n"
        "Identify the logical or thematic links between "
        "these fragments. What patterns emerge?\n"
        "\n"
        "### \U0001f4a1 Possible Research Angles\n"
        "Based on these connections, what research "
        "directions could be explored?\n"
        "\n"
        "### \U0001f680 Next Steps\n"
        "Concrete actions to explore these ideas further.\n"
        "\n"
        "Respond in the same language as the fragments."
    )
