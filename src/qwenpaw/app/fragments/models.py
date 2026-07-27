# -*- coding: utf-8 -*-
"""Fragment (碎片标签) data models."""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class FragmentStance(str, Enum):
    """Fragment type classification."""

    insight = "insight"
    question = "question"
    analogy = "analogy"
    todo = "todo"
    reference = "reference"


class FragmentSpec(BaseModel):
    """A single fragment (灵感碎片) with auto-generated metadata."""

    id: str = Field(
        default_factory=lambda: uuid4().hex[:12],
        description="Fragment identifier",
    )
    surface: str = Field(
        default="",
        description="Surface text (≤30 chars summary)",
    )
    gist: str = Field(
        default="",
        description="One-line distillation",
    )
    topics: List[str] = Field(
        default_factory=list,
        description="Auto-inferred topic tags (2-4)",
    )
    stance: FragmentStance = Field(
        default=FragmentStance.insight,
        description="Fragment type",
    )
    spark: str = Field(
        default="",
        description="Why this is interesting (optional)",
    )
    source_text: str = Field(
        default="",
        description="Original captured text",
    )
    source_session_id: Optional[str] = Field(
        default=None,
        description="Source conversation session ID",
    )
    source_seq: Optional[int] = Field(
        default=None,
        description="Source message sequence number",
    )
    generation: int = Field(
        default=0,
        description="0=user-created, 1+=collide-generated",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )


class FragmentCreate(BaseModel):
    """Request body for creating a fragment."""

    source_text: str = Field(..., description="Text to capture")
    source_session_id: Optional[str] = None
    source_seq: Optional[int] = None
    surface: Optional[str] = None
    gist: Optional[str] = None
    topics: Optional[List[str]] = None
    stance: Optional[FragmentStance] = None
    spark: Optional[str] = None
    generation: int = 0


class FragmentUpdate(BaseModel):
    """Mutable fragment fields."""

    surface: Optional[str] = None
    gist: Optional[str] = None
    topics: Optional[List[str]] = None
    stance: Optional[FragmentStance] = None
    spark: Optional[str] = None


class CollideRequest(BaseModel):
    """Request body for fragment collision."""

    fragment_ids: List[str] = Field(
        ...,
        min_length=2,
        description="IDs of fragments to collide",
    )
    mode: str = Field(
        default="analytical",
        description="Collision mode: analytical or creative",
    )


class CollideResult(BaseModel):
    """Result of a fragment collision."""

    connections: str = Field(default="", description="Discovered connections")
    angles: str = Field(default="", description="Research angles")
    next_steps: str = Field(default="", description="Suggested next steps")
    full_text: str = Field(default="", description="Full collision output")


class FragmentsFile(BaseModel):
    """Fragment registry for JSON storage."""

    version: int = 1
    fragments: List[FragmentSpec] = Field(default_factory=list)
