# -*- coding: utf-8 -*-
"""Internal bridges from trusted host request contexts."""

from contextvars import ContextVar

from .context import RequestContext

request_identity: ContextVar[RequestContext | None] = ContextVar(
    "sdk_request_identity",
    default=None,
)


def from_runtime(runtime) -> RequestContext:
    request = getattr(runtime, "request", None)
    # Legacy prompt assembly supplies an Agent rather than HookContext. Both
    # are host-owned; never inspect plugin/client-supplied metadata for identity.
    legacy = getattr(runtime, "_request_context", {}) or {}
    return RequestContext(
        getattr(runtime, "agent_id", "") or legacy.get("agent_id", ""),
        getattr(runtime, "session_id", "") or legacy.get("session_id", ""),
        getattr(request, "channel", "") or legacy.get("channel", ""),
        getattr(request, "user_id", "") or legacy.get("user_id", ""),
    )
