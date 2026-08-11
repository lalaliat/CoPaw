# -*- coding: utf-8 -*-
# pylint: disable=protected-access
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from qwenpaw.app.auth import AuthMiddleware


@pytest.mark.parametrize(
    "path",
    [
        "/api/routines/routine-1/fire",
        "/api/agents/default/routines/routine-1/fire",
    ],
)
def test_routine_fire_uses_its_own_token(path):
    request = MagicMock()
    request.method = "POST"
    request.url.path = path

    with (
        patch("qwenpaw.app.auth.is_auth_enabled", return_value=True),
        patch("qwenpaw.app.auth.has_registered_users", return_value=True),
    ):
        assert AuthMiddleware._should_skip_auth(request) is True


def test_auth_is_not_skipped_for_similar_paths():
    request = MagicMock()
    request.method = "POST"
    request.url.path = "/api/admin/routines/routine-1/fire/extra"
    request.client.host = "203.0.113.1"
    config = SimpleNamespace(
        security=SimpleNamespace(allow_no_auth_hosts=[]),
    )

    with (
        patch("qwenpaw.app.auth.is_auth_enabled", return_value=True),
        patch("qwenpaw.app.auth.has_registered_users", return_value=True),
        patch("qwenpaw.app.auth._get_config_cached", return_value=(config, 0)),
    ):
        assert AuthMiddleware._should_skip_auth(request) is False
