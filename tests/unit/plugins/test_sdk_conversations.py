# -*- coding: utf-8 -*-
"""Selected history uses authenticated HTTP identity and persisted host state."""

from dataclasses import asdict
from types import SimpleNamespace

import pytest

from qwenpaw.plugins.apps import PawApp, ChatRequest
from qwenpaw.plugins.errors import StaleContextError
from qwenpaw.plugins.messages import ContentBlock
from qwenpaw.plugins.providers import ProviderSpec, ModelInfo, ModelChunk


async def test_selected_history_scope_projection_and_lifetime(
    sdk_component,
    tmp_path,
):
    retained = []

    def declare(ctx):
        app = PawApp(app_id="history-sample")

        @app.route("/history")
        async def history(call, request):
            retained.append(call.conversations)
            return {
                "messages": [
                    asdict(item)
                    for item in await call.conversations.history(limit=2)
                ],
                "projects": [
                    str(path)
                    for path in await call.workspace_ops.project_directories()
                ],
            }

        ctx.register_app(app)

    async with sdk_component(declare, capabilities=("apps",)) as (host, _):
        workspace = await host._workspace("one")
        other = await host._workspace("two")
        project = tmp_path / "selected-project"
        project.mkdir()
        own = await workspace.chat_manager.get_or_create_chat(
            "main",
            "default",
            "console",
        )
        await workspace.chat_manager.set_session_project_dirs(
            own.id,
            [{"path": str(project)}],
        )
        raw = [
            {"role": "user", "content": "old"},
            {"role": "system", "content": "secret system"},
            {
                "role": "user",
                "content": "question",
                "metadata": {"private": "hidden"},
            },
            {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "secret reasoning"},
                    {"type": "tool_use", "input": {"secret": "secret tool"}},
                    {"type": "text", "text": "answer"},
                ],
            },
        ]
        await workspace.session.save_session_state(
            "main",
            "default",
            "console",
            agent=SimpleNamespace(
                state_dict=lambda: {"state": {"context": raw}},
            ),
        )
        response = await host.request(
            "GET",
            "/api/history-sample/history?agent_id=one",
            headers={"X-Chat-Id": own.id},
            user_id="default",
            workspace_id="one",
        )
        assert response.status == 200
        assert response.json() == {
            "messages": [
                {"role": "user", "content": "question"},
                {"role": "assistant", "content": "answer"},
            ],
            "projects": [str(project)],
        }
        with pytest.raises(StaleContextError):
            await retained[-1].history()
        forbidden = ["missing", ""]
        for owner, channel, sid, ws in (
            ("bob", "console", "main", workspace),
            ("default", "email", "main", workspace),
            ("default", "console", "pawapp:other", workspace),
            ("default", "console", "main", other),
        ):
            chat = await ws.chat_manager.get_or_create_chat(
                sid,
                owner,
                channel,
            )
            forbidden.append(chat.id)
        for selected in forbidden:
            response = await host.request(
                "GET",
                "/api/history-sample/history?agent_id=one",
                headers={"X-Chat-Id": selected},
                user_id="default",
                workspace_id="one",
            )
            assert response.status == 403, (selected, response.text)


async def test_history_reads_actual_runtime_saved_turn(sdk_component):
    def declare(ctx):
        async def generate(call, request):
            yield ModelChunk(
                (ContentBlock(text="saved answer"),),
                is_last=True,
            )

        ctx.register_provider(
            ProviderSpec(
                "history",
                "History",
                generate,
                models=(ModelInfo("model", "Model"),),
                require_api_key=False,
            ),
        )
        app = PawApp(app_id="saved-history")

        @app.route("/history")
        async def history(call, request):
            return [
                asdict(item) for item in await call.conversations.history()
            ]

        ctx.register_app(app)

    async with sdk_component(declare, capabilities=("apps", "providers")) as (
        host,
        _,
    ):
        await host.configure_chat_model("history", "model", workspace_id="one")
        workspace = await host._workspace("one")
        chat = await workspace.chat_manager.get_or_create_chat(
            "actual",
            "default",
            "console",
        )
        events = [
            event
            async for event in host.stream_chat(
                ChatRequest("saved question", session_id="actual"),
                workspace_id="one",
                user_id="default",
            )
        ]
        assert events
        response = await host.request(
            "GET",
            "/api/saved-history/history?agent_id=one",
            headers={"X-Chat-Id": chat.id},
            user_id="default",
            workspace_id="one",
        )
        assert response.status == 200
        assert response.json()[-2:] == [
            {"role": "user", "content": "saved question"},
            {"role": "assistant", "content": "saved answer"},
        ]
