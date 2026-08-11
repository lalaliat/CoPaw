# -*- coding: utf-8 -*-
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from ..agent_context import get_agent_for_request
from .manager import (
    RoutineManager,
    RoutineQueueFull,
    RoutineRateLimitExceeded,
)
from .models import (
    RoutineFireRequest,
    RoutineFireResponse,
    RoutineMutationResponse,
    RoutineRun,
    RoutineSpec,
    RoutineView,
)

router = APIRouter(prefix="/routines", tags=["routines"])
MAX_ROUTINE_API_REQUEST_BYTES = 10 * 1024 * 1024


def _content_length(request: Request) -> int | None:
    value = request.headers.get("content-length")
    if not value:
        return None
    try:
        return max(0, int(value))
    except ValueError:
        return None


async def _read_limited_body(request: Request, limit_bytes: int) -> bytes:
    content_length = _content_length(request)
    if content_length is not None and content_length > limit_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Routine API request exceeds {limit_bytes} bytes",
        )
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Routine API request exceeds {limit_bytes} bytes",
            )
    return bytes(body)


async def get_routine_manager(request: Request) -> RoutineManager:
    workspace = await get_agent_for_request(request)
    manager = workspace.routine_manager
    if manager is None:
        raise HTTPException(
            status_code=500,
            detail="RoutineManager not initialized",
        )
    return manager


@router.get("", response_model=list[RoutineView])
async def list_routines(
    manager: RoutineManager = Depends(get_routine_manager),
):
    return await manager.list_views()


@router.get("/{routine_id}", response_model=RoutineView)
async def get_routine(
    routine_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    routine = await manager.get_view(routine_id)
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found")
    return routine


@router.post("", response_model=RoutineMutationResponse)
async def create_routine(
    routine: RoutineSpec,
    manager: RoutineManager = Depends(get_routine_manager),
):
    view, token = await manager.create(routine)
    return RoutineMutationResponse(routine=view, api_token=token)


@router.put("/{routine_id}", response_model=RoutineMutationResponse)
async def update_routine(
    routine_id: str,
    routine: RoutineSpec,
    manager: RoutineManager = Depends(get_routine_manager),
):
    try:
        view, token = await manager.update(routine_id, routine)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="Routine not found",
        ) from exc
    return RoutineMutationResponse(routine=view, api_token=token)


@router.delete("/{routine_id}")
async def delete_routine(
    routine_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    if not await manager.delete(routine_id):
        raise HTTPException(status_code=404, detail="Routine not found")
    return {"deleted": True}


@router.post("/{routine_id}/enable", response_model=RoutineView)
async def enable_routine(
    routine_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    try:
        return await manager.set_enabled(routine_id, True)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="Routine not found",
        ) from exc


@router.post("/{routine_id}/pause", response_model=RoutineView)
async def pause_routine(
    routine_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    try:
        return await manager.set_enabled(routine_id, False)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="Routine not found",
        ) from exc


@router.post("/{routine_id}/run", response_model=RoutineRun)
async def run_routine(
    routine_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    try:
        return await manager.run_manual(routine_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="Routine not found",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{routine_id}/runs", response_model=list[RoutineRun])
async def list_routine_runs(
    routine_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    try:
        return await manager.list_runs(routine_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="Routine not found",
        ) from exc


@router.get("/{routine_id}/runs/{run_id}", response_model=RoutineRun)
async def get_routine_run(
    routine_id: str,
    run_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    run = await manager.get_run(routine_id, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Routine run not found")
    return run


@router.post("/{routine_id}/api-token", response_model=RoutineMutationResponse)
async def rotate_routine_token(
    routine_id: str,
    manager: RoutineManager = Depends(get_routine_manager),
):
    try:
        view, token = await manager.rotate_token(routine_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="Routine API trigger not found",
        ) from exc
    return RoutineMutationResponse(routine=view, api_token=token)


@router.post("/{routine_id}/fire", response_model=RoutineFireResponse)
async def fire_routine(
    routine_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
    manager: RoutineManager = Depends(get_routine_manager),
):
    content_length = _content_length(request)
    if (
        content_length is not None
        and content_length > MAX_ROUTINE_API_REQUEST_BYTES
    ):
        raise HTTPException(
            status_code=413,
            detail="Routine API request exceeds the 10 MB system limit",
        )
    token = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token or not await manager.verify_token(routine_id, token):
        raise HTTPException(status_code=401, detail="Invalid Routine token")
    try:
        limit_bytes = await manager.get_fire_request_limit_bytes(routine_id)
        raw_body = await _read_limited_body(
            request,
            min(limit_bytes, MAX_ROUTINE_API_REQUEST_BYTES),
        )
        if raw_body:
            try:
                payload = RoutineFireRequest.model_validate_json(raw_body)
            except ValidationError as exc:
                raise RequestValidationError(exc.errors()) from exc
        else:
            payload = RoutineFireRequest()
        return await manager.fire(routine_id, payload)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail="Routine not found",
        ) from exc
    except RoutineRateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "message": "Routine API rate limit exceeded",
                "retry_after_seconds": exc.retry_after_seconds,
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except RoutineQueueFull as exc:
        raise HTTPException(
            status_code=429,
            detail="Routine waiting queue is full",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
