"""Offline tests against QwenPaw hooks and the real approval store."""

import asyncio
import importlib.util
import inspect
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "system_sound_test_module",
    Path(__file__).with_name("plugin.py"),
)
sound = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sound)

from qwenpaw.app.approvals.models import ApprovalRequestSummary
from qwenpaw.app.approvals.service import ApprovalService
from qwenpaw.runtime.hooks import HookContext, HookRegistry
from qwenpaw.runtime.phases import Phase
from qwenpaw.security.tool_guard.models import ToolGuardResult


class Installation(unittest.IsolatedAsyncioTestCase):
    async def test_real_loader_start_unload_reload(self):
        from qwenpaw.plugins.loader import PluginLoader
        from qwenpaw.plugins.registry import PluginRegistry

        old_registry = PluginRegistry._instance
        PluginRegistry._instance = None
        self.addCleanup(setattr, PluginRegistry, "_instance", old_registry)
        source = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(prefix="sound-install-") as directory:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient

            loader = PluginLoader([Path(directory)])
            app = FastAPI()
            loader.registry.set_plugin_http_app(app)
            hooks = HookRegistry()
            workspace = SimpleNamespace(plugins=SimpleNamespace(hook_registry=hooks))
            loader.registry.set_workspace_manager(
                SimpleNamespace(agents={"test": workspace}),
            )
            original = ApprovalService.create_pending
            for iteration in range(2):
                record = await loader.load_plugin_from_path(source)
                try:
                    self.assertTrue(record.enabled, record.diagnostics)
                    for hook in loader.registry.get_startup_hooks():
                        result = hook.callback()
                        if inspect.isawaitable(result):
                            await result
                    self.assertEqual(len(hooks.hooks_for(Phase.FINALLY)), 1)
                    self.assertIsNot(ApprovalService.create_pending, original)
                    with TestClient(app) as client:
                        preferences = client.get("/api/system-sound/settings").json()[
                            "settings"
                        ]
                        if iteration == 0:
                            preferences["volume"] = 45
                            self.assertEqual(
                                client.put(
                                    "/api/system-sound/settings", json=preferences
                                ).status_code,
                                200,
                            )
                        else:
                            self.assertEqual(preferences["volume"], 45)
                finally:
                    await loader.unload_plugin("system-sound")
                self.assertEqual(hooks.hooks_for(Phase.FINALLY), [])
                self.assertEqual(hooks.hooks_for(Phase.POST_RESPONSE), [])
                self.assertIs(ApprovalService.create_pending, original)

    async def test_manifest_accepts_2_and_later_rejects_1(self):
        from qwenpaw._version_compat import check_plugin_version_compat
        from qwenpaw.plugins.architecture import PluginManifest

        manifest = PluginManifest(
            **json.loads(
                Path(__file__).with_name("plugin.json").read_text(),
            )
        )
        for version, expected in (
            ("1.9.9", False),
            ("2.0.0", True),
            ("2.0.1", True),
            ("2.1.0", True),
            ("2.2.0", True),
            ("2.2.1b2", True),
            ("2.10.0", True),
            ("3.0.0", True),
        ):
            with (
                self.subTest(version=version),
                patch(
                    "qwenpaw.__version__.__version__",
                    version,
                ),
            ):
                accepted, reason = check_plugin_version_compat(manifest)
                self.assertEqual(accepted, expected, reason)


class Notifications(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.plugin = sound.SystemSoundPlugin()
        directory = tempfile.TemporaryDirectory(prefix="sound-settings-")
        self.addCleanup(directory.cleanup)
        self.plugin.settings_path = Path(directory.name) / "system-sound.json"
        self.worker = Mock()
        self.worker_patch = patch.object(sound, "SoundWorker", return_value=self.worker)
        self.worker_patch.start()
        self.addCleanup(self.worker_patch.stop)
        self.addCleanup(self.plugin.stop)
        self.originals = {
            name: getattr(ApprovalService, name)
            for name in ("create_pending", "create_pending_summary")
        }
        self.addCleanup(self.restore_methods)
        self.plugin.start()
        self.api = Mock()
        self.plugin.register(self.api)
        self.registry = HookRegistry()
        self.api._get_all_workspaces.return_value = [
            SimpleNamespace(plugins=SimpleNamespace(hook_registry=self.registry)),
        ]
        for call in self.api.register_runtime_hook.call_args_list:
            self.registry.register(call.args[0])

    def restore_methods(self):
        for name, method in self.originals.items():
            setattr(ApprovalService, name, method)

    def context(self):
        return HookContext(
            request=None,
            session_id="session",
            agent_id="default",
            root_session_id="session",
            root_agent_id="default",
            workspace_dir=None,
            workspace=None,
            app_services=None,
            agent=object(),
        )

    async def test_completion_once_after_finally(self):
        ctx = self.context()
        await self.registry.run(Phase.PRE_DISPATCH, ctx)
        await self.registry.run(Phase.POST_RESPONSE, ctx)
        self.worker.submit.assert_not_called()
        await self.registry.run(Phase.FINALLY, ctx)
        await self.registry.run(Phase.FINALLY, ctx)
        self.worker.submit.assert_called_once_with("completion")

    async def test_error_cancel_and_command_do_not_sound(self):
        for error in (RuntimeError("failed"), asyncio.CancelledError()):
            ctx = self.context()
            await self.registry.run(Phase.PRE_DISPATCH, ctx)
            await self.registry.run(Phase.POST_RESPONSE, ctx)
            ctx.error = error
            await self.registry.run(Phase.FINALLY, ctx)
        ctx = self.context()
        ctx.agent = None
        await self.registry.run(Phase.PRE_DISPATCH, ctx)
        await self.registry.run(Phase.POST_RESPONSE, ctx)
        await self.registry.run(Phase.FINALLY, ctx)
        await self.registry.run(Phase.FINALLY, self.context())
        self.worker.submit.assert_not_called()

    async def create(self, service, generic=False):
        kwargs = dict(
            session_id="s",
            root_session_id="s",
            owner_agent_id="default",
            user_id="u",
            channel="console",
            agent_id="default",
        )
        if generic:
            return await service.create_pending_summary(
                **kwargs,
                summary=ApprovalRequestSummary("plugin", "test"),
            )
        return await service.create_pending(
            **kwargs,
            tool_name="test",
            result=ToolGuardResult("test", {}),
        )

    async def test_both_real_approval_paths_preserve_records(self):
        service = ApprovalService()
        for generic in (False, True):
            pending = await self.create(service, generic)
            self.assertIs(service._pending[pending.request_id], pending)
            self.assertFalse(pending.future.done())
        self.assertEqual(self.worker.submit.call_count, 2)
        self.worker.submit.assert_called_with("approval")

    async def test_audio_failure_does_not_break_approval(self):
        self.worker.submit.side_effect = RuntimeError("no audio")
        with self.assertLogs(sound.LOG, "WARNING"):
            pending = await self.create(ApprovalService())
        self.assertEqual(pending.status, "pending")

    async def test_invalid_approval_does_not_sound(self):
        with self.assertRaises(TypeError):
            await ApprovalService().create_pending()
        self.worker.submit.assert_not_called()

    async def test_start_is_idempotent_and_uninstall_restores(self):
        self.plugin.start()
        await self.create(ApprovalService())
        self.worker.submit.assert_called_once_with("approval")
        self.plugin.stop(plugin_id="system-sound", delete_files=True)
        for name, original in self.originals.items():
            self.assertIs(getattr(ApprovalService, name), original)
        await self.create(ApprovalService())
        self.assertEqual(self.worker.submit.call_count, 1)
        self.assertFalse(self.registry.hooks_for(Phase.FINALLY))

    async def test_later_wrapper_preserved_and_restart_not_duplicated(self):
        inner = ApprovalService.create_pending

        async def other(service, **kwargs):
            return await inner(service, **kwargs)

        ApprovalService.create_pending = other
        self.plugin.stop()
        self.assertIs(ApprovalService.create_pending, other)
        await self.create(ApprovalService())
        self.worker.submit.assert_not_called()
        self.plugin.start()
        await self.create(ApprovalService())
        self.worker.submit.assert_called_once_with("approval")

    async def test_disabled_switches(self):
        self.plugin.enabled = dict.fromkeys(sound.EVENTS, False)
        await self.create(ApprovalService())
        ctx = self.context()
        await self.registry.run(Phase.PRE_DISPATCH, ctx)
        await self.registry.run(Phase.POST_RESPONSE, ctx)
        await self.registry.run(Phase.FINALLY, ctx)
        self.worker.submit.assert_not_called()

    async def test_actual_runtime_success_and_error(self):
        from qwenpaw.runtime.runtime import Runtime

        workspace = SimpleNamespace(
            plugins=SimpleNamespace(
                hook_registry=self.registry,
                modes=[],
                slash_command_registry=SimpleNamespace(dispatch=Mock()),
            )
        )

        async def dispatch(*_args):
            return None

        workspace.plugins.slash_command_registry.dispatch = dispatch

        async def build(_builder, ctx):
            return ctx.agent

        for failure in (False, True):

            async def execute(*_args):
                if failure:
                    raise RuntimeError("simulated agent failure")
                if False:
                    yield None

            runtime = Runtime(workspace=workspace, app_services=None)
            ctx = self.context()
            with (
                patch.object(runtime, "_normalize", side_effect=lambda req: req),
                patch.object(runtime, "_build_context", return_value=ctx),
                patch("qwenpaw.runtime.runtime.AgentBuilder.build", build),
                patch("qwenpaw.runtime.runtime.AgentExecutor.run", execute),
            ):
                if failure:
                    with self.assertRaisesRegex(RuntimeError, "simulated"):
                        async for _ in runtime.run(None):
                            pass
                else:
                    async for _ in runtime.run(None):
                        pass
        self.worker.submit.assert_called_once_with("completion")


class Collaboration(unittest.IsolatedAsyncioTestCase):
    setUp = Notifications.setUp
    restore_methods = Notifications.restore_methods
    context = Notifications.context

    async def begin(self, agent="A", session="root", rc=None, coordinator=None):
        ctx = self.context()
        ctx.agent_id = ctx.root_agent_id = agent
        ctx.session_id = ctx.root_session_id = session
        ctx.request = SimpleNamespace(request_context=rc or {})
        ctx.app_services = SimpleNamespace(tool_coordinator=coordinator)
        await self.registry.run(Phase.PRE_DISPATCH, ctx)
        return ctx

    async def finish(self, ctx, error=None):
        ctx.error = error
        if error is None:
            await self.registry.run(Phase.POST_RESPONSE, ctx)
        await self.registry.run(Phase.FINALLY, ctx)

    async def wire_child(self, payload, target):
        # Exercise the real console boundary, where top-level root fields can
        # be dropped while request_context survives across supported versions.
        from qwenpaw.app.routers.console import _extract_session_and_payload
        from qwenpaw.app.channels.console.channel import ConsoleChannel
        from qwenpaw.runtime.runtime import Runtime

        channel = object.__new__(ConsoleChannel)
        request = channel.build_agent_request_from_native(
            _extract_session_and_payload(payload)
        )
        runtime = Runtime(workspace=SimpleNamespace(agent_id=target), app_services=None)
        ctx = runtime._build_context(request)
        ctx.agent = object()
        await self.registry.run(Phase.PRE_DISPATCH, ctx)
        return ctx

    async def test_cross_agent_foreground_and_nested_calls(self):
        from qwenpaw.agents.tools.agent_management import build_agent_chat_request

        root = await self.begin()

        async def local_reply(base_url, request_payload, to_agent, timeout):
            child = await self.wire_child(request_payload, to_agent)
            if to_agent == "B":
                _, nested, _ = build_agent_chat_request(
                    "C", "nested", from_agent="B", root_session_id="child-B"
                )
                await wrapped(None, nested, "C", 30)
            await self.finish(child)
            self.worker.submit.assert_not_called()
            return {"status": "completed"}

        wrapped = self.plugin._delegation_wrapper(local_reply, False)
        _, payload, _ = build_agent_chat_request(
            "B", "work", from_agent="A", root_session_id="root"
        )
        await wrapped(None, payload, "B", 30)
        self.assertNotIn(sound.LINEAGE, payload["request_context"])
        await self.finish(root)
        self.worker.submit.assert_called_once_with("completion")

    async def test_same_agent_parallel_spawn_and_fork(self):
        root = await self.begin()

        async def local_reply(base_url, request_payload, to_agent, timeout):
            child = await self.wire_child(request_payload, to_agent)
            await asyncio.sleep(0)
            await self.finish(child)

        wrapped = self.plugin._delegation_wrapper(local_reply, False)
        await asyncio.gather(
            *(
                wrapped(
                    None,
                    {
                        "session_id": f"child-{i}",
                        "request_context": {
                            "_spawn_subagent": True,
                            "root_session_id": "root",
                            "root_agent_id": "A",
                            "parent_session_id": "root",
                            "fork_project_dir": f"/tmp/worktree-{i}",
                        },
                    },
                    "A",
                    30,
                )
                for i in range(4)
            )
        )
        self.worker.submit.assert_not_called()
        await self.finish(root)
        self.worker.submit.assert_called_once_with("completion")

    async def test_background_does_not_sound_until_root_returns_again(self):
        from qwenpaw.app.routers import console

        tasks = {}
        captured = []

        def submit(base_url, request_payload, to_agent, timeout):
            captured.append(request_payload)
            task_id = f"task-{len(captured)}"
            tasks[task_id] = SimpleNamespace(status="running", result=None)
            return {"task_id": task_id}

        with patch.object(console, "_bg_tasks", tasks):
            root = await self.begin()
            wrapped = self.plugin._delegation_wrapper(submit, True)
            for i in range(3):
                await asyncio.to_thread(
                    wrapped, None, {"session_id": f"child-{i}"}, "B", 30
                )
            await self.finish(root)
            self.worker.submit.assert_not_called()
            for i, payload in enumerate(captured):
                child = await self.wire_child(payload, "B")
                await self.finish(child)
                tasks[f"task-{i+1}"].status = "finished"
                tasks[f"task-{i+1}"].result = {"status": "completed"}
            self.worker.submit.assert_not_called()
            await self.finish(await self.begin())
            self.worker.submit.assert_called_once_with("completion")

    async def test_unknown_background_status_is_not_completion(self):
        root = await self.begin()

        def submit(base_url, request_payload, to_agent, timeout):
            return {"task_id": "not-in-local-task-store"}

        wrapped = self.plugin._delegation_wrapper(submit, True)
        wrapped(None, {"session_id": "child"}, "B", 30)
        await self.finish(root)
        self.worker.submit.assert_not_called()

    async def test_background_finishing_during_cleanup_does_not_sound(self):
        from qwenpaw.app.routers import console

        tasks = {"task": SimpleNamespace(status="running")}

        def submit(base_url, request_payload, to_agent, timeout):
            return {"task_id": "task"}

        with patch.object(console, "_bg_tasks", tasks):
            root = await self.begin()
            self.plugin._delegation_wrapper(submit, True)(
                None, {"session_id": "child"}, "B", 30
            )
            await self.registry.run(Phase.POST_RESPONSE, root)
            tasks["task"].status = "finished"
            await self.registry.run(Phase.FINALLY, root)
            self.worker.submit.assert_not_called()

    async def test_tracking_error_does_not_fail_agent_call_or_guess_completion(self):
        root = await self.begin()

        def submit(base_url, request_payload, to_agent, timeout):
            return {"task_id": "task"}

        with (
            patch.object(
                self.plugin.collaboration,
                "prepare_call",
                side_effect=RuntimeError("tracking unavailable"),
            ),
            self.assertLogs(sound.LOG, "WARNING"),
        ):
            result = self.plugin._delegation_wrapper(submit, True)(
                None, {"session_id": "child"}, "B", 30
            )
        self.assertEqual(result["task_id"], "task")
        await self.finish(root)
        self.worker.submit.assert_not_called()

    async def test_offloaded_tool_and_independent_session(self):
        from qwenpaw.tool_calls._coordinator import ToolCoordinator
        from qwenpaw.tool_calls._entry import ToolCallStatus

        coordinator = ToolCoordinator()
        legacy = (
            {"result_finalizer": None}
            if "result_finalizer"
            in inspect.signature(coordinator._create_entry).parameters
            else {}
        )
        entry = coordinator._create_entry(
            SimpleNamespace(id="tool", name="test"), "root", "A", "root", None, **legacy
        )
        entry.status = ToolCallStatus.OFFLOADED
        coordinator._entries["tool"] = entry
        root = await self.begin(coordinator=coordinator)
        await self.finish(root)
        self.worker.submit.assert_not_called()
        # Another agent using the same session ID is an independent root.
        await self.finish(await self.begin(agent="B", coordinator=coordinator))
        self.worker.submit.assert_called_once_with("completion")
        await coordinator._finalize_completed(entry)
        await self.finish(await self.begin(coordinator=coordinator))
        self.assertEqual(self.worker.submit.call_count, 2)

    async def test_disabled_root_only_restores_each_session_sound(self):
        settings = self.plugin.settings_snapshot()
        settings["root_only"] = False
        self.plugin.save_settings(settings)
        root = await self.begin()
        child = await self.begin(
            session="child", rc={"_spawn_subagent": True, "root_session_id": "root"}
        )
        await self.finish(child)
        await self.finish(root)
        self.assertEqual(self.worker.submit.call_count, 2)

    async def test_child_approval_still_sounds_in_root_only_mode(self):
        child = await self.begin(
            session="child", rc={"_spawn_subagent": True, "root_session_id": "root"}
        )
        await ApprovalService().create_pending_summary(
            session_id="child",
            root_session_id="root",
            owner_agent_id="A",
            user_id="u",
            channel="console",
            agent_id="B",
            summary=ApprovalRequestSummary("plugin", "test"),
        )
        await self.finish(child)
        self.worker.submit.assert_called_once_with("approval")

    async def test_cancelled_root_and_late_child_stay_silent(self):
        root = await self.begin()
        rc = {
            sound.LINEAGE: {
                "family": root.extras[sound.RUN]["family"],
                "agent": "A",
                "session": "root",
            }
        }
        child = await self.begin("B", "child", rc)
        await self.finish(root, asyncio.CancelledError())
        await self.finish(child)
        self.worker.submit.assert_not_called()

    async def test_child_failure_then_root_explanation(self):
        root = await self.begin()
        rc = {
            sound.LINEAGE: {
                "family": root.extras[sound.RUN]["family"],
                "agent": "A",
                "session": "root",
            }
        }
        child = await self.begin("B", "child", rc)
        await self.finish(child, RuntimeError("failed"))
        self.worker.submit.assert_not_called()
        await self.finish(root)
        self.worker.submit.assert_called_once_with("completion")

    async def test_hot_reload_keeps_family_state(self):
        from qwenpaw.plugins.api import PluginApi
        from qwenpaw.plugins.registry import PluginRegistry

        registry = PluginRegistry()
        api = PluginApi("system-sound", {}, {})
        api._registry = registry
        registry._system_sound_collaboration = self.plugin.collaboration
        # Registration is mocked only to avoid mounting routes twice. The
        # registry-attached tracker and in-flight family are real.
        with (
            patch.object(api, "register_runtime_hook"),
            patch.object(api, "register_startup_hook"),
            patch.object(api, "register_shutdown_hook"),
            patch.object(api, "register_uninstall_hook"),
            patch.object(api, "register_http_router"),
        ):
            newer = sound.SystemSoundPlugin()
            newer.register(api)
        self.assertIs(newer.collaboration, self.plugin.collaboration)


class NativeAudio(unittest.TestCase):
    def test_windows_pcm_volume_does_not_change_global_volume(self):
        import wave
        import io

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tone.wav"
            with wave.open(str(path), "wb") as output:
                output.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
                output.writeframes(b"\xe8\x03\x18\xfc")
            scaled = sound.scaled_wave(path, 50)
        with wave.open(io.BytesIO(scaled), "rb") as result:
            self.assertEqual(result.readframes(2), b"\xf4\x01\x0c\xfe")

    def test_macos_uses_fixed_system_sound_without_shell(self):
        with (
            patch.object(sound.platform, "system", return_value="Darwin"),
            patch.object(sound.subprocess, "run") as run,
        ):
            sound.play_system_sound("approval")
        self.assertEqual(
            run.call_args.args[0],
            [
                "/usr/bin/afplay",
                "-v",
                "1.0",
                "/System/Library/Sounds/Ping.aiff",
            ],
        )
        self.assertEqual(run.call_args.kwargs["timeout"], 5)
        self.assertNotIn("shell", run.call_args.kwargs)

    def test_worker_recovers_from_audio_failure_and_stops(self):
        player = Mock(side_effect=[RuntimeError("missing device"), None])
        worker = sound.SoundWorker(player)
        with self.assertLogs(sound.LOG, "WARNING"):
            worker.start()
            worker.submit("completion")
            worker.submit("approval")
            worker.pending.join()
        worker.close()
        worker.thread.join(timeout=1)
        self.assertFalse(worker.thread.is_alive())
        self.assertEqual(player.call_count, 2)
        worker.submit("completion")
        self.assertTrue(worker.pending.empty())


class SettingsAPI(unittest.TestCase):
    def test_old_settings_migrate_without_losing_choices(self):
        before = self.owner.settings_snapshot()
        before.pop("root_only")
        before["volume"] = 27
        self.owner.settings_path.write_text(json.dumps(before))
        self.owner.load_settings()
        self.assertTrue(self.owner.preferences["root_only"])
        self.assertEqual(self.owner.preferences["volume"], 27)

    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        directory = tempfile.TemporaryDirectory(prefix="sound-api-")
        self.addCleanup(directory.cleanup)
        self.owner = sound.SystemSoundPlugin()
        self.owner.settings_path = (
            Path(directory.name) / "preferences" / "system-sound.json"
        )
        worker_patch = patch.object(sound, "SoundWorker")
        self.worker = worker_patch.start().return_value
        self.addCleanup(worker_patch.stop)
        self.owner.start()
        self.addCleanup(self.owner.stop)
        app = FastAPI()
        app.include_router(self.owner.build_router(), prefix="/system-sound")
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_save_reload_and_immediate_notification_preferences(self):
        data = self.client.get("/system-sound/settings").json()
        settings = data["settings"]
        settings["completion"]["enabled"] = False
        settings["approval"]["sound"] = data["sounds"][-1]["value"]
        settings["volume"] = 35
        self.assertEqual(
            self.client.put("/system-sound/settings", json=settings).status_code, 200
        )
        self.owner.notify("completion")
        self.worker.submit.assert_not_called()
        with patch.object(sound, "play_system_sound") as player:
            self.owner.play_notification("approval")
            player.assert_called_once_with(
                "approval", settings["approval"]["sound"], 35
            )
        reloaded = sound.SystemSoundPlugin()
        reloaded.settings_path = self.owner.settings_path
        reloaded.load_settings()
        self.assertEqual(reloaded.settings_snapshot(), settings)

    def test_approval_can_be_enabled_without_restart(self):
        settings = self.owner.settings_snapshot()
        settings["approval"]["enabled"] = False
        self.owner.save_settings(settings)
        self.owner.stop()
        self.owner.start()
        self.owner.notify("approval")
        self.worker.submit.assert_not_called()
        settings["approval"]["enabled"] = True
        self.client.put("/system-sound/settings", json=settings)
        asyncio.run(
            ApprovalService().create_pending_summary(
                session_id="s",
                root_session_id="s",
                owner_agent_id="a",
                user_id="u",
                channel="console",
                agent_id="a",
                summary=ApprovalRequestSummary("test", "test"),
            )
        )
        self.worker.submit.assert_called_once_with("approval")

    def test_preview_uses_draft_and_does_not_save(self):
        before = self.owner.settings_path.read_bytes()
        with patch.object(sound, "play_system_sound") as player:
            response = self.client.post(
                "/system-sound/preview",
                json={"event": "approval", "sound": "default", "volume": 25},
            )
            self.assertEqual(response.status_code, 200)
            player.assert_called_once_with("approval", "default", 25)
        self.assertEqual(self.owner.settings_path.read_bytes(), before)

    def test_invalid_sound_and_volume_do_not_write_or_play(self):
        before = self.owner.settings_path.read_bytes()
        for value in (-1, 101, True, "40"):
            settings = self.owner.settings_snapshot()
            settings["volume"] = value
            self.assertEqual(
                self.client.put("/system-sound/settings", json=settings).status_code,
                422,
            )
        with patch.object(sound, "play_system_sound") as player:
            response = self.client.post(
                "/system-sound/preview",
                json={"event": "approval", "sound": "../../secret", "volume": 50},
            )
            self.assertEqual(response.status_code, 422)
            player.assert_not_called()
        self.assertEqual(self.owner.settings_path.read_bytes(), before)

    def test_failed_save_keeps_active_and_persisted_settings(self):
        before = self.owner.settings_snapshot()
        changed = dict(before, volume=20)
        with (
            patch.object(sound.os, "replace", side_effect=OSError("disk full")),
            self.assertLogs(sound.LOG, "WARNING"),
        ):
            response = self.client.put("/system-sound/settings", json=changed)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.owner.settings_snapshot(), before)
        self.assertEqual(json.loads(self.owner.settings_path.read_text()), before)

    def test_preview_failure_is_reported(self):
        with (
            patch.object(
                sound, "play_system_sound", side_effect=RuntimeError("no device")
            ),
            self.assertLogs(sound.LOG, "WARNING"),
        ):
            response = self.client.post(
                "/system-sound/preview",
                json={"event": "approval", "sound": "default", "volume": 50},
            )
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
