# -*- coding: utf-8 -*-
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from ..crons.models import DispatchSpec, JobRuntimeSpec, ScheduleSpec


class RoutineScheduleTrigger(BaseModel):
    enabled: bool = True
    schedule: ScheduleSpec


class RoutineApiTrigger(BaseModel):
    enabled: bool = True
    token_hint: Optional[str] = None
    requests_per_minute: int = Field(default=3, ge=1, le=1000)
    max_pending_runs: int = Field(default=3, ge=1, le=100)
    max_request_size_kb: int = Field(default=256, ge=1, le=10240)


class RoutineSpec(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1)
    description: Optional[str] = None
    prompt: str = Field(min_length=1)
    enabled: bool = True

    tool_mode: Literal["all", "custom"] = "all"
    allowed_tools: list[str] = Field(default_factory=list)

    schedule_trigger: Optional[RoutineScheduleTrigger] = None
    api_trigger: Optional[RoutineApiTrigger] = None
    trigger_logic: Literal["or", "and"] = "or"

    isolate_session: bool = True
    dispatch: DispatchSpec
    save_result_to_inbox: bool = True
    runtime: JobRuntimeSpec = Field(default_factory=JobRuntimeSpec)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _validate_trigger_logic(self) -> "RoutineSpec":
        if not self.dispatch.target.user_id.strip():
            raise ValueError("result delivery user_id is required")
        if not self.dispatch.target.session_id.strip():
            raise ValueError("result delivery session_id is required")
        if self.trigger_logic == "and":
            has_schedule = bool(
                self.schedule_trigger and self.schedule_trigger.enabled,
            )
            has_api = bool(self.api_trigger and self.api_trigger.enabled)
            if not (has_schedule and has_api):
                raise ValueError(
                    "trigger_logic 'and' requires both schedule and API "
                    "triggers",
                )
        if self.tool_mode == "all":
            self.allowed_tools = []
        return self


RoutineRunStatus = Literal[
    "queued",
    "running",
    "success",
    "error",
    "cancelled",
]
RoutineRunTrigger = Literal["manual", "scheduled", "api"]


class RoutineRun(BaseModel):
    run_id: str
    routine_id: str
    trigger: RoutineRunTrigger
    status: RoutineRunStatus = "queued"
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    summary: Optional[str] = None
    error: Optional[str] = None
    session_id: Optional[str] = None
    trace_id: Optional[str] = None
    trigger_text: Optional[str] = None
    trigger_data: dict[str, Any] = Field(default_factory=dict)


class RoutineView(BaseModel):
    spec: RoutineSpec
    last_run: Optional[RoutineRun] = None
    next_run_at: Optional[datetime] = None
    fire_path: Optional[str] = None


class RoutineMutationResponse(BaseModel):
    routine: RoutineView
    api_token: Optional[str] = None


class RoutineFireRequest(BaseModel):
    text: Optional[str] = Field(default=None, max_length=65536)
    event_id: Optional[str] = Field(default=None, max_length=512)
    data: dict[str, Any] = Field(default_factory=dict)


class RoutineFireResponse(BaseModel):
    status: Literal["queued", "pending"]
    run_id: Optional[str] = None
    duplicate: bool = False


class RoutinesFile(BaseModel):
    version: int = 1
    routines: list[RoutineSpec] = Field(default_factory=list)
