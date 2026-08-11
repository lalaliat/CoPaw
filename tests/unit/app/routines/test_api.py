# -*- coding: utf-8 -*-
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.routines.api import get_routine_manager, router
from qwenpaw.app.routines.manager import (
    RoutineQueueFull,
    RoutineRateLimitExceeded,
)
from qwenpaw.app.routines.models import RoutineFireResponse


def make_client(manager: MagicMock) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_routine_manager] = lambda: manager
    return TestClient(app)


def make_manager(*, request_limit: int = 1024) -> MagicMock:
    manager = MagicMock()
    manager.verify_token = AsyncMock(return_value=True)
    manager.get_fire_request_limit_bytes = AsyncMock(
        return_value=request_limit,
    )
    manager.fire = AsyncMock(
        return_value=RoutineFireResponse(status="queued", run_id="run-1"),
    )
    return manager


def test_fire_rejects_request_larger_than_routine_limit():
    manager = make_manager(request_limit=8)

    response = make_client(manager).post(
        "/routines/routine-1/fire",
        headers={"Authorization": "Bearer token"},
        content=b'{"text":"too large"}',
    )

    assert response.status_code == 413
    manager.fire.assert_not_awaited()


def test_fire_accepts_an_empty_request_body():
    manager = make_manager()

    response = make_client(manager).post(
        "/routines/routine-1/fire",
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == 200
    payload = manager.fire.await_args.args[1]
    assert payload.text is None
    assert payload.event_id is None
    assert payload.data == {}


def test_fire_returns_retry_after_when_rate_limited():
    manager = make_manager()
    manager.fire.side_effect = RoutineRateLimitExceeded(42)

    response = make_client(manager).post(
        "/routines/routine-1/fire",
        headers={"Authorization": "Bearer token"},
        json={},
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "42"
    assert response.json()["detail"]["retry_after_seconds"] == 42


def test_fire_rejects_when_waiting_queue_is_full():
    manager = make_manager()
    manager.fire.side_effect = RoutineQueueFull()

    response = make_client(manager).post(
        "/routines/routine-1/fire",
        headers={"Authorization": "Bearer token"},
        json={},
    )

    assert response.status_code == 429
    assert response.json()["detail"] == "Routine waiting queue is full"
