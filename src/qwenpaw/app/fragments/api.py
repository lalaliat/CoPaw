# -*- coding: utf-8 -*-
"""Fragment Tags API endpoints."""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from .manager import FragmentManager
from .models import (
    CollideRequest,
    FragmentCreate,
    FragmentSpec,
    FragmentUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fragments", tags=["fragments"])


async def get_workspace(request: Request):
    from ..agent_context import get_agent_for_request

    return await get_agent_for_request(request)


async def get_fragment_manager(request: Request) -> FragmentManager:
    workspace = await get_workspace(request)
    fm = getattr(workspace, "_fragment_manager", None)
    if fm is None:
        fm = FragmentManager(
            workspace.workspace_dir / "fragments.json",
        )
        setattr(workspace, "_fragment_manager", fm)
    return fm


@router.get("", response_model=List[FragmentSpec])
async def list_fragments(
    topics: Optional[str] = Query(
        None,
        description="Comma-separated topic filter",
    ),
    stance: Optional[str] = Query(None, description="Filter by stance type"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    topic_list = [t.strip() for t in topics.split(",")] if topics else None
    return await mgr.list_fragments(
        topics=topic_list,
        stance=stance,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/topics", response_model=List[str])
async def get_all_topics(
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    return await mgr.get_all_topics()


@router.get("/{fragment_id}", response_model=FragmentSpec)
async def get_fragment(
    fragment_id: str,
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    fragment = await mgr.get_fragment(fragment_id)
    if fragment is None:
        raise HTTPException(status_code=404, detail="Fragment not found")
    return fragment


@router.post("", response_model=FragmentSpec)
async def create_fragment(
    body: FragmentCreate,
    request: Request,
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    workspace = await get_workspace(request)
    fragment = await mgr.create_fragment(body)

    # Background task: auto-generate meta if not provided
    if not body.surface and not body.gist:

        async def _generate_meta():
            try:
                from .meta_generator import generate_fragment_meta

                meta = await generate_fragment_meta(
                    workspace,
                    body.source_text,
                )
                if meta:
                    update = FragmentUpdate(**meta)
                    await mgr.update_fragment(fragment.id, update)
                    logger.debug(
                        "Auto-generated meta for fragment %s",
                        fragment.id,
                    )
            except Exception:
                logger.debug(
                    "Meta generation failed for fragment %s",
                    fragment.id,
                    exc_info=True,
                )

        asyncio.create_task(_generate_meta())

    return fragment


@router.put("/{fragment_id}", response_model=FragmentSpec)
async def update_fragment(
    fragment_id: str,
    body: FragmentUpdate,
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    updated = await mgr.update_fragment(fragment_id, body)
    if updated is None:
        raise HTTPException(status_code=404, detail="Fragment not found")
    return updated


@router.delete("/{fragment_id}")
async def delete_fragment(
    fragment_id: str,
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    deleted = await mgr.delete_fragment(fragment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Fragment not found")
    return {"deleted": True}


@router.post("/batch-delete")
async def batch_delete_fragments(
    fragment_ids: List[str],
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    count = await mgr.delete_fragments(fragment_ids)
    return {"deleted": count}


@router.post("/collide")
async def collide_fragments(
    body: CollideRequest,
    request: Request,
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    """Collide selected fragments to discover connections.

    Uses the active model directly (like title_generator) instead of the
    full Runtime pipeline, since collision needs no tools or memory recall.
    """
    workspace = await get_workspace(request)
    fragments = []
    for fid in body.fragment_ids:
        f = await mgr.get_fragment(fid)
        if f is None:
            raise HTTPException(
                status_code=404,
                detail=f"Fragment not found: {fid}",
            )
        fragments.append(f)

    from .collider import build_collide_prompt

    prompt = build_collide_prompt(fragments, mode=body.mode)

    async def _stream():
        try:
            from ...agents.model_factory import create_model_and_formatter
            from ...exceptions import AppBaseException

            try:
                model, _ = create_model_and_formatter(
                    agent_id=workspace.agent_id,
                )
            except (ValueError, AppBaseException) as exc:
                yield f"Error: no model available ({exc})"
                return

            from agentscope.message import Msg, TextBlock
            from ...utils.model_response import extract_response_text

            messages = [
                Msg(
                    name="user",
                    role="user",
                    content=[TextBlock(type="text", text=prompt)],
                ),
            ]

            response = await model(messages, stream=True)
            if hasattr(response, "__aiter__"):
                prev_text = ""
                async for chunk in response:
                    text = extract_response_text(chunk)
                    if text and len(text) > len(prev_text):
                        yield text[len(prev_text) :]
                        prev_text = text
            else:
                yield extract_response_text(response)

        except Exception as exc:
            logger.exception("Collide streaming failed")
            yield f"\n\n[Error: {exc}]"

    return StreamingResponse(
        _stream(),
        media_type="text/plain",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.post("/regenerate-meta/{fragment_id}", response_model=FragmentSpec)
async def regenerate_meta(
    fragment_id: str,
    request: Request,
    mgr: FragmentManager = Depends(get_fragment_manager),
):
    """Regenerate metadata for a fragment using the LLM."""
    fragment = await mgr.get_fragment(fragment_id)
    if fragment is None:
        raise HTTPException(status_code=404, detail="Fragment not found")

    workspace = await get_workspace(request)
    from .meta_generator import generate_fragment_meta

    meta = await generate_fragment_meta(workspace, fragment.source_text)
    if meta:
        update = FragmentUpdate(**meta)
        updated = await mgr.update_fragment(fragment_id, update)
        return updated
    return fragment
