# -*- coding: utf-8 -*-
"""Run queries use real Runtime dispatch and enforce exact request ownership."""

import asyncio
import json

import pytest

from qwenpaw.plugins.commands import CommandResult, CommandSpec
from qwenpaw.plugins.events import EventSubscription, RunEvent
from qwenpaw.plugins.messages import ContentBlock, Message
from qwenpaw.plugins.errors import StaleContextError


async def test_real_runs_query_snapshot_identity_and_reused_request_id(
    sdk_component,
):
    from qwenpaw.plugins.apps import ChatRequest

    received, retained, current_ids = [], [], set()

    def declare(ctx):
        async def query(call, arguments):
            retained.append(call.runs)
            current = await call.runs.current()
            if current:
                assert current.user_id == call.identity.user_id
                assert current.workspace_id == call.identity.workspace_id
                assert current.session_id == call.identity.session_id
                current_ids.add(current.run_id)
            visible = await call.runs.list()
            selected = await call.runs.get(arguments) if arguments else None
            payload = {
                "current": current.run_id if current else None,
                "visible": [item.run_id for item in visible],
                "selected": selected.run_id if selected else None,
            }
            return CommandResult(
                "reply",
                Message(
                    "assistant",
                    (ContentBlock(text=json.dumps(payload)),),
                ),
            )

        async def observe(call, event):
            if isinstance(event, RunEvent):
                received.append((event, await call.runs.get(event.run_id)))

        ctx.register_command(CommandSpec("runs", query))
        ctx.on_activate(
            lambda active: active.subscribe_events(EventSubscription(observe)),
        )

    async with sdk_component(declare, capabilities=("commands", "events")) as (
        host,
        ctx,
    ):

        async def run(user, session, workspace="one"):
            return [
                event
                async for event in host.stream_chat(
                    ChatRequest(
                        "/runs",
                        session_id=session,
                        request_id="reused-client-id",
                    ),
                    workspace_id=workspace,
                    user_id=user,
                )
            ]

        await asyncio.gather(
            run("alice", "shared"),
            run("bob", "shared"),
            run("alice", "different"),
        )
        await run("alice", "shared", "two")
        async with asyncio.timeout(5):
            while (
                len(
                    [
                        event
                        for event, _ in received
                        if event.kind == "run.completed"
                    ],
                )
                < 4
            ):
                await asyncio.sleep(0.01)
        started = [
            event for event, _ in received if event.kind == "run.started"
        ]
        completed = [
            event for event, _ in received if event.kind == "run.completed"
        ]
        assert len({event.snapshot.run_id for event in started}) == 4
        assert current_ids == {event.snapshot.run_id for event in started}
        assert all(event.run_id == "reused-client-id" for event in started)
        assert all(
            event.snapshot.status == "running"
            and event.snapshot.finished_at is None
            for event in started
        )
        assert all(
            event.snapshot.status == "completed"
            and event.snapshot.finished_at >= event.snapshot.started_at
            for event in completed
        )
        alice = next(
            event
            for event in completed
            if event.user_id == "alice"
            and event.session_id == "shared"
            and event.workspace_id == "one"
        )
        for user, session, workspace, allowed in (
            ("alice", "shared", "one", True),
            ("bob", "shared", "one", False),
            ("alice", "different", "one", False),
            ("alice", "shared", "two", False),
        ):
            result = await host.call_command(
                f"/runs {alice.snapshot.run_id}",
                workspace_id=workspace,
                session_id=session,
                user_id=user,
            )
            payload = json.loads(result.content[0].text)
            assert payload["current"] is None
            assert (alice.snapshot.run_id in payload["visible"]) is allowed
            assert bool(payload["selected"]) is allowed
        with pytest.raises(StaleContextError):
            await retained[0].list()


async def test_cancelled_runtime_keeps_terminal_snapshot(sdk_component):
    entered, finished = asyncio.Event(), asyncio.Event()
    events = []

    def declare(ctx):
        async def slow(call, arguments):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                finished.set()

        async def observe(call, event):
            if isinstance(event, RunEvent):
                events.append(event)

        ctx.register_command(CommandSpec("slow-run", slow))
        ctx.on_activate(
            lambda active: active.subscribe_events(EventSubscription(observe)),
        )

    async with sdk_component(declare, capabilities=("commands", "events")) as (
        host,
        ctx,
    ):

        async def run():
            return [event async for event in host.stream_chat("/slow-run")]

        task = asyncio.create_task(run())
        await asyncio.wait_for(entered.wait(), 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert finished.is_set()
        async with asyncio.timeout(5):
            while not any(event.kind == "run.cancelled" for event in events):
                await asyncio.sleep(0.01)
        terminal = next(
            event for event in events if event.kind == "run.cancelled"
        )
        assert terminal.snapshot.status == "cancelled"
        assert terminal.snapshot.finished_at is not None


async def test_approval_origin_is_bound_only_with_matching_host_identity(
    sdk_component,
):
    from qwenpaw.app.approvals.service import get_approval_service
    from qwenpaw.app.approvals.models import ApprovalRequestSummary
    from qwenpaw.security.tool_guard.approval import ApprovalDecision
    from qwenpaw.plugins.events import ApprovalEvent

    observed, expected = [], {}

    def declare(ctx):
        async def request(call, arguments):
            current = await call.runs.current()
            identity = call.identity
            service = get_approval_service()
            for user in (identity.user_id, "someone-else"):
                pending = await service.create_pending_summary(
                    session_id=identity.session_id,
                    root_session_id=identity.session_id,
                    owner_agent_id=identity.workspace_id,
                    agent_id=identity.workspace_id,
                    user_id=user,
                    channel=identity.channel,
                    summary=ApprovalRequestSummary("sdk-test", "confirm"),
                )
                expected[pending.request_id] = (
                    current.run_id if user == identity.user_id else None
                )
                await service.resolve_request(
                    pending.request_id,
                    ApprovalDecision.APPROVED,
                )
            return CommandResult(
                "reply",
                Message("assistant", (ContentBlock(text="done"),)),
            )

        async def observe(call, event):
            if isinstance(event, ApprovalEvent):
                observed.append(event)

        ctx.register_command(CommandSpec("approval-origin", request))
        ctx.on_activate(
            lambda active: active.subscribe_events(EventSubscription(observe)),
        )

    async with sdk_component(declare, capabilities=("commands", "events")) as (
        host,
        ctx,
    ):
        events = [
            event async for event in host.stream_chat("/approval-origin")
        ]
        assert any(event.status == "completed" for event in events)
        async with asyncio.timeout(5):
            while len(observed) < 4:
                await asyncio.sleep(0.01)
        assert {event.kind for event in observed} == {
            "approval.pending",
            "approval.approved",
        }
        for event in observed:
            assert event.approval.run_id == expected[event.approval.request_id]
