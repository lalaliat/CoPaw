# -*- coding: utf-8 -*-
"""Fragment manager: CRUD operations for fragment tags."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from qwenpaw.utils.io_utils import read_json, run_sync_io, write_json_atomic

from .models import (
    FragmentSpec,
    FragmentCreate,
    FragmentUpdate,
    FragmentsFile,
)

logger = logging.getLogger(__name__)


class FragmentManager:
    """Manages fragment CRUD with JSON file persistence."""

    def __init__(self, fragments_path: Path):
        self._path = fragments_path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _load_sync(self) -> FragmentsFile:
        if not self._path.exists():
            return FragmentsFile(version=1, fragments=[])
        try:
            return FragmentsFile.model_validate(read_json(self._path))
        except Exception:
            logger.warning("Failed to load fragments file, starting fresh")
            return FragmentsFile(version=1, fragments=[])

    async def _load(self) -> FragmentsFile:
        return await run_sync_io(self._load_sync)

    def _save_sync(self, data: FragmentsFile) -> None:
        write_json_atomic(
            self._path,
            data.model_dump(mode="json"),
            sort_keys=True,
        )

    async def _save(self, data: FragmentsFile) -> None:
        await run_sync_io(self._save_sync, data)

    async def list_fragments(
        self,
        *,
        topics: Optional[List[str]] = None,
        stance: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> List[FragmentSpec]:
        data = await self._load()
        fragments = data.fragments

        if topics:
            topic_set = set(t.lower() for t in topics)
            fragments = [
                f
                for f in fragments
                if any(t.lower() in topic_set for t in f.topics)
            ]

        if stance:
            fragments = [f for f in fragments if f.stance == stance]

        reverse = sort_order == "desc"
        if sort_by == "created_at":
            fragments.sort(key=lambda f: f.created_at, reverse=reverse)
        elif sort_by == "updated_at":
            fragments.sort(key=lambda f: f.updated_at, reverse=reverse)

        return fragments

    async def get_fragment(self, fragment_id: str) -> Optional[FragmentSpec]:
        data = await self._load()
        for f in data.fragments:
            if f.id == fragment_id:
                return f
        return None

    async def create_fragment(self, create: FragmentCreate) -> FragmentSpec:
        data = await self._load()
        now = datetime.now(timezone.utc)
        spec = FragmentSpec(
            id=uuid4().hex[:12],
            surface=create.surface or "",
            gist=create.gist or "",
            topics=create.topics or [],
            stance=create.stance or "insight",
            spark=create.spark or "",
            source_text=create.source_text,
            source_session_id=create.source_session_id,
            source_seq=create.source_seq,
            generation=create.generation,
            created_at=now,
            updated_at=now,
        )
        data.fragments.append(spec)
        await self._save(data)
        return spec

    async def update_fragment(
        self,
        fragment_id: str,
        update: FragmentUpdate,
    ) -> Optional[FragmentSpec]:
        data = await self._load()
        for i, f in enumerate(data.fragments):
            if f.id == fragment_id:
                update_dict = update.model_dump(exclude_none=True)
                if update_dict:
                    update_dict["updated_at"] = datetime.now(timezone.utc)
                    data.fragments[i] = f.model_copy(update=update_dict)
                    await self._save(data)
                return data.fragments[i]
        return None

    async def delete_fragment(self, fragment_id: str) -> bool:
        data = await self._load()
        original_len = len(data.fragments)
        data.fragments = [f for f in data.fragments if f.id != fragment_id]
        if len(data.fragments) < original_len:
            await self._save(data)
            return True
        return False

    async def delete_fragments(self, fragment_ids: List[str]) -> int:
        data = await self._load()
        id_set = set(fragment_ids)
        original_len = len(data.fragments)
        data.fragments = [f for f in data.fragments if f.id not in id_set]
        deleted = original_len - len(data.fragments)
        if deleted > 0:
            await self._save(data)
        return deleted

    async def get_all_topics(self) -> List[str]:
        """Get all unique topics across all fragments."""
        data = await self._load()
        topics = set()
        for f in data.fragments:
            for t in f.topics:
                topics.add(t)
        return sorted(topics)
