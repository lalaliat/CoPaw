# -*- coding: utf-8 -*-
"""Bind public workflow declarations to native workspace cron managers."""

import asyncio
from dataclasses import fields
from contextvars import Context
import inspect
import math
import re

from .context import RequestContext
from .errors import ResourceError, SDKError
from .resources import Registration
from .workflows import WorkflowContext, WorkflowNotification, WorkflowResult


def register(plugin, spec):
    from apscheduler.triggers.cron import CronTrigger
    from ..app.crons.contracts import ServiceCronJob
    from ._events import freeze
    from ._models import json_mapping

    plugin._guard()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", spec.name):
        raise SDKError("Workflow requires a simple name")
    if not inspect.iscoroutinefunction(spec.handler):
        raise SDKError("Workflow handler must be async")
    if not math.isfinite(spec.timeout) or spec.timeout <= 0:
        raise SDKError("Workflow timeout must be finite and positive")
    CronTrigger.from_crontab(
        spec.schedule.cron,
        timezone=spec.schedule.timezone or "UTC",
    )
    if not isinstance(spec.schedule.workspace_ids, tuple) or any(
        not isinstance(value, str) or not value
        for value in spec.schedule.workspace_ids
    ):
        raise SDKError(
            "Workflow workspace_ids must contain nonempty identifiers",
        )
    parameters = freeze(json_mapping(spec.parameters))
    name = plugin.plugin_id + ":" + spec.name
    projector = plugin._loader.registry.projector
    if projector._find("sdk_workflow", name, plugin.plugin_id) is not None:
        raise SDKError("Workflow already registered: " + name)
    admitted = True

    async def apply(workspace):
        if not admitted:
            return None
        with plugin._activation():
            scope = plugin.resources.child(workspace_id=workspace.agent_id)
            pending_scope = None

            async def drain():
                if pending_scope is not None and not pending_scope.closed:
                    await pending_scope.close()

            scope.defer(drain, "workflow invocation resources")
        running = False

        async def invoke(scheduled, arguments):
            nonlocal pending_scope
            async with plugin._invocation(
                workspace_id=workspace.agent_id,
                session_id="",
                identity=RequestContext(
                    workspace_id=workspace.agent_id,
                    channel="workflow",
                ),
                deadline=asyncio.get_running_loop().time() + spec.timeout,
            ) as base:
                pending_scope = base.resources
                base.workspace_ops.directory
                call = WorkflowContext(
                    **{
                        item.name: getattr(base, item.name)
                        for item in fields(base)
                    },
                    scheduled=scheduled,
                )
                async with asyncio.timeout(spec.timeout):
                    result = await spec.handler(call, arguments)
                call.check_cancelled()
                if (
                    not isinstance(result, WorkflowResult)
                    or type(result.success) is not bool
                    or not isinstance(result.text, str)
                ):
                    raise SDKError(
                        "Workflow handler must return WorkflowResult",
                    )
                notification = result.notification
                if notification is not None:
                    if (
                        not isinstance(notification, WorkflowNotification)
                        or not isinstance(notification.title, str)
                        or not isinstance(notification.body, str)
                    ):
                        raise SDKError(
                            "Workflow notification must contain title and body strings",
                        )
                    from ..app.inbox_store import append_event

                    await append_event(
                        agent_id=call.workspace_id,
                        source_type="cron",
                        source_id=name,
                        event_type="plugin_workflow",
                        status="success" if result.success else "error",
                        title=notification.title[:200],
                        body=notification.body[:65536],
                        payload={
                            "plugin_id": plugin.plugin_id,
                            "workflow": spec.name,
                        },
                    )
                call.logger.info(
                    "Workflow finished",
                    fields={
                        "workflow": spec.name,
                        "success": result.success,
                        "result": result.text[:65536],
                    },
                )
                return result

        async def owned(scheduled, arguments):
            try:
                return await invoke(scheduled, arguments)
            except Exception as exc:
                # A business failure belongs to scheduler logging, not an
                # unbounded list of historical resource-cleanup errors.
                return exc

        async def run(*, scheduled=True, parameters_override=None):
            nonlocal running
            if not admitted or scope.closed or scope._closing:
                raise SDKError("Workflow registration has ended")
            if running:
                raise SDKError("Workflow is already running in this workspace")
            arguments = (
                parameters
                if parameters_override is None
                else freeze(json_mapping(parameters_override))
            )
            running = True
            try:
                # Failed/slow cleanup keeps the previous invocation's custody;
                # do not start another occurrence over its live resources.
                await drain()
                # Scheduled service work must not inherit the installing
                # HTTP request's user, model, project or cancellation context.
                result = await Context().run(
                    scope.task,
                    owned(scheduled, arguments),
                    "workflow:" + name,
                )
                if isinstance(result, Exception):
                    raise result
                return result
            finally:
                running = False

        manager = workspace.cron_manager
        try:
            job = manager.register_service_job(
                "sdk_" + plugin.plugin_id,
                ServiceCronJob(
                    spec.name,
                    spec.schedule.cron,
                    run,
                    misfire_grace_seconds=60,
                    timezone=spec.schedule.timezone,
                ),
            )
        except BaseException:
            await scope.close()
            raise
        return manager, job, scope

    async def revoke(workspace, token):
        manager, job, scope = token
        manager.unregister_service_job(job)
        await scope.close()

    plugin._api._schedule_workspace_intent(
        "sdk_workflow",
        name,
        apply,
        revoke,
        can_apply=lambda ws: admitted
        and getattr(ws, "cron_manager", None) is not None
        and (
            not spec.schedule.workspace_ids
            or ws.agent_id in spec.schedule.workspace_ids
        ),
        binding_is_current=lambda ws, token: ws.cron_manager is token[0],
    )
    intent = projector._find("sdk_workflow", name, plugin.plugin_id)

    async def release():
        nonlocal admitted
        admitted = False
        try:
            await projector.revoke(
                "sdk_workflow",
                name,
                plugin.plugin_id,
                expected=intent,
            )
        except RuntimeError as exc:
            raise ResourceError(str(exc)) from exc

    handle = Registration(
        release,
        owner=plugin.resources.owner,
        description="workflow:" + name,
        _bounded=False,
    )
    plugin._instance.record_runtime(handle.description, handle.close)
    return handle
