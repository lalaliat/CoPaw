# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from ...utils.io_utils import (
    read_json,
    run_sync_io,
    unlink_async,
    write_json_atomic,
)
from .models import RoutineRun, RoutineSpec, RoutinesFile


class RoutineRepository:
    """Local JSON persistence for routine specs, runs, and trigger state."""

    def __init__(self, path: Path | str):
        self._path = Path(path).expanduser()
        self._runs_dir = self._path.with_name("routine_runs")
        self._state_path = self._path.with_name("routine_trigger_state.json")
        self._lock = asyncio.Lock()

    def _load_file(self) -> RoutinesFile:
        if not self._path.exists():
            return RoutinesFile()
        return RoutinesFile.model_validate(read_json(self._path))

    async def list_routines(self) -> list[RoutineSpec]:
        return (await run_sync_io(self._load_file)).routines

    async def get_routine(self, routine_id: str) -> Optional[RoutineSpec]:
        routines = await self.list_routines()
        return next((item for item in routines if item.id == routine_id), None)

    async def upsert_routine(self, routine: RoutineSpec) -> None:
        async with self._lock:
            payload = await run_sync_io(self._load_file)
            payload.routines = [
                item for item in payload.routines if item.id != routine.id
            ]
            payload.routines.append(routine)
            await run_sync_io(
                write_json_atomic,
                self._path,
                payload.model_dump(mode="json"),
                sort_keys=True,
            )

    async def delete_routine(self, routine_id: str) -> bool:
        async with self._lock:
            payload = await run_sync_io(self._load_file)
            kept = [item for item in payload.routines if item.id != routine_id]
            if len(kept) == len(payload.routines):
                return False
            payload.routines = kept
            await run_sync_io(
                write_json_atomic,
                self._path,
                payload.model_dump(mode="json"),
                sort_keys=True,
            )
            state = await run_sync_io(self._load_state)
            state.get("tokens", {}).pop(routine_id, None)
            state.get("pending", {}).pop(routine_id, None)
            state.get("seen_events", {}).pop(routine_id, None)
            await run_sync_io(self._save_state, state)
        await unlink_async(self._run_path(routine_id))
        return True

    def _run_path(self, routine_id: str) -> Path:
        return self._runs_dir / f"{quote(routine_id, safe='')}.json"

    def _load_runs(self, routine_id: str) -> list[RoutineRun]:
        path = self._run_path(routine_id)
        if not path.exists():
            return []
        data = read_json(path)
        if not isinstance(data, list):
            return []
        return [RoutineRun.model_validate(item) for item in data]

    async def list_runs(self, routine_id: str) -> list[RoutineRun]:
        return await run_sync_io(self._load_runs, routine_id)

    async def save_run(self, run: RoutineRun, limit: int = 100) -> None:
        async with self._lock:
            runs = await run_sync_io(self._load_runs, run.routine_id)
            runs = [item for item in runs if item.run_id != run.run_id]
            runs.insert(0, run)
            del runs[limit:]
            await run_sync_io(
                write_json_atomic,
                self._run_path(run.routine_id),
                [item.model_dump(mode="json") for item in runs],
                sort_keys=True,
            )

    async def get_run(
        self,
        routine_id: str,
        run_id: str,
    ) -> Optional[RoutineRun]:
        runs = await self.list_runs(routine_id)
        return next((item for item in runs if item.run_id == run_id), None)

    def _load_state(self) -> dict[str, Any]:
        if not self._state_path.exists():
            return {"tokens": {}, "pending": {}, "seen_events": {}}
        data = read_json(self._state_path)
        if not isinstance(data, dict):
            return {"tokens": {}, "pending": {}, "seen_events": {}}
        data.setdefault("tokens", {})
        data.setdefault("pending", {})
        data.setdefault("seen_events", {})
        return data

    def _save_state(self, state: dict[str, Any]) -> None:
        write_json_atomic(self._state_path, state, sort_keys=True)

    async def set_token(self, routine_id: str, token: str) -> None:
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        async with self._lock:
            state = await run_sync_io(self._load_state)
            state["tokens"][routine_id] = digest
            await run_sync_io(self._save_state, state)

    async def verify_token(self, routine_id: str, token: str) -> bool:
        import hmac

        state = await run_sync_io(self._load_state)
        expected = state["tokens"].get(routine_id)
        actual = hashlib.sha256(token.encode("utf-8")).hexdigest()
        return bool(expected and hmac.compare_digest(expected, actual))

    async def revoke_token(self, routine_id: str) -> None:
        async with self._lock:
            state = await run_sync_io(self._load_state)
            state["tokens"].pop(routine_id, None)
            await run_sync_io(self._save_state, state)

    async def remember_event(self, routine_id: str, event_id: str) -> bool:
        """Return False if the event was already seen."""
        if not event_id:
            return True
        async with self._lock:
            state = await run_sync_io(self._load_state)
            events = state["seen_events"].setdefault(routine_id, [])
            if event_id in events:
                return False
            events.insert(0, event_id)
            del events[200:]
            await run_sync_io(self._save_state, state)
            return True

    async def forget_event(self, routine_id: str, event_id: str) -> None:
        """Allow a rejected event to be retried later."""
        if not event_id:
            return
        async with self._lock:
            state = await run_sync_io(self._load_state)
            events = state["seen_events"].get(routine_id, [])
            state["seen_events"][routine_id] = [
                item for item in events if item != event_id
            ]
            await run_sync_io(self._save_state, state)

    async def set_pending(
        self,
        routine_id: str,
        payload: dict[str, Any],
    ) -> None:
        async with self._lock:
            state = await run_sync_io(self._load_state)
            state["pending"][routine_id] = payload
            await run_sync_io(self._save_state, state)

    async def clear_pending(self, routine_id: str) -> None:
        async with self._lock:
            state = await run_sync_io(self._load_state)
            state["pending"].pop(routine_id, None)
            await run_sync_io(self._save_state, state)

    async def pop_pending(self, routine_id: str) -> Optional[dict[str, Any]]:
        async with self._lock:
            state = await run_sync_io(self._load_state)
            payload = state["pending"].pop(routine_id, None)
            await run_sync_io(self._save_state, state)
            return payload if isinstance(payload, dict) else None
