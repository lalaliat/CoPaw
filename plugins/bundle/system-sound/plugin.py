"""Local OS notifications. No model calls, network access, or audio assets."""

from __future__ import annotations

import functools
import asyncio
import contextvars
import inspect
import io
import json
import logging
import math
import os
import platform
import queue
import shutil
import subprocess
import threading
import tempfile
import uuid
import wave
from pathlib import Path

LOG = logging.getLogger("qwenpaw.plugins.system_sound")
EVENTS = ("completion", "approval")
MARKER = "system-sound:response-ready"
LINEAGE = "_system_sound_lineage"
RUN = "system-sound:run"
ROOT_READY = "system-sound:root-ready"


class CollaborationTracker:
    """Track a root conversation and its local delegated work, not LLM text.

    Only a root Runtime FINALLY can authorize a sound. A background completion
    never emits one or resumes the agent. ContextVars cross asyncio.to_thread;
    a private request_context field crosses inter-agent HTTP boundaries.
    """

    def __init__(self):
        self.lock = threading.RLock()
        self.current = contextvars.ContextVar("system_sound_run", default=None)
        self.families = {}
        self.roots = {}

    @staticmethod
    def identity(ctx):
        rc = getattr(ctx.request, "request_context", None) or {}
        if not isinstance(rc, dict):
            rc = {}
        marker = rc.get(LINEAGE)
        if isinstance(marker, dict) and all(
            isinstance(marker.get(key), str) and marker[key]
            for key in ("family", "agent", "session")
        ):
            return (marker["agent"], marker["session"]), marker["family"], False
        agent, session = ctx.agent_id, ctx.session_id
        root_agent = rc.get("root_agent_id") or ctx.root_agent_id or agent
        root_session = rc.get("root_session_id") or ctx.root_session_id or session
        root = (root_agent, root_session)
        is_root = (
            root == (agent, session)
            and not rc.get("_spawn_subagent")
            and not rc.get("parent_session_id")
        )
        return root, None, is_root

    def enter(self, ctx):
        root, inherited, is_root = self.identity(ctx)
        with self.lock:
            family_id = inherited or self.roots.get(root) or uuid.uuid4().hex
            family = self.families.setdefault(
                family_id,
                {
                    "root": root,
                    "active": set(),
                    "pending": {},
                    "members": set(),
                    "coordinators": [],
                },
            )
            if is_root:
                self.roots[root] = family_id
            run = {
                "family": family_id,
                "root": root,
                "is_root": is_root,
                "token": uuid.uuid4().hex,
            }
            family["active"].add(run["token"])
            family["members"].add((ctx.agent_id, ctx.session_id))
            coordinator = getattr(ctx.app_services, "tool_coordinator", None)
            if coordinator is not None and all(
                coordinator is not c for c in family["coordinators"]
            ):
                family["coordinators"].append(coordinator)
            run["context_token"] = self.current.set(run)
            ctx.extras[RUN] = run

    def _busy(self, family, excluding=None):
        if family.get("uncertain"):
            return True
        if family["active"] - {excluding}:
            return True
        from qwenpaw.app.routers.console import _bg_tasks

        for token, task_id in list(family["pending"].items()):
            if task_id is None:  # submission has not returned yet
                return True
            task = _bg_tasks.get(task_id)
            if task is None or task.status != "finished":
                return True
            # Failed/cancelled children are settled too. The root may finish a
            # normal reply explaining failure; child settlement never sounds.
            del family["pending"][token]
        for coordinator in family["coordinators"]:
            for entry in coordinator.list_entries():
                identity = (entry.ctx.agent_id, entry.ctx.session_id)
                if identity in family["members"] and str(entry.status) != "completed":
                    return True
        return False

    def mark_uncertain(self):
        run = self.current.get()
        if run is not None:
            with self.lock:
                family = self.families.get(run["family"])
                if family is not None:
                    family["uncertain"] = True

    def can_finish(self, ctx):
        run = ctx.extras.get(RUN)
        if run is None or not run["is_root"]:
            return False
        with self.lock:
            family = self.families.get(run["family"])
            return family is not None and not self._busy(family, excluding=run["token"])

    def leave(self, ctx):
        run = ctx.extras.pop(RUN, None)
        if run is None:
            return False  # not observed from the start; do not guess completion
        try:
            self.current.reset(run["context_token"])
        except ValueError:
            # A generator can be closed by another task during shutdown.
            pass
        with self.lock:
            family = self.families.get(run["family"])
            if family is None:
                return False
            family["active"].discard(run["token"])
            if not run["is_root"]:
                return False
            settled = not self._busy(family)
            if settled:
                self.families.pop(run["family"], None)
                if self.roots.get(run["root"]) == run["family"]:
                    self.roots.pop(run["root"], None)
            return settled

    def prepare_call(self, original, args, kwargs, background):
        run = self.current.get()
        if run is None:
            return args, kwargs, None
        bound = inspect.signature(original).bind(*args, **kwargs)
        payload = bound.arguments.get("request_payload")
        if not isinstance(payload, dict):
            return args, kwargs, None
        payload = dict(payload)
        rc = dict(payload.get("request_context") or {})
        rc[LINEAGE] = {
            "family": run["family"],
            "agent": run["root"][0],
            "session": run["root"][1],
        }
        payload["request_context"] = rc
        bound.arguments["request_payload"] = payload
        token = uuid.uuid4().hex
        with self.lock:
            family = self.families.get(run["family"])
            if family is None:
                return args, kwargs, None
            family["active"].add(token)  # includes requests not started remotely
            if background:
                family["pending"][token] = None
        return bound.args, bound.kwargs, (run["family"], token, background)

    def finish_call(self, handle, result):
        if handle is None:
            return
        family_id, token, background = handle
        with self.lock:
            family = self.families.get(family_id)
            if family is None:
                return
            family["active"].discard(token)
            if background:
                task_id = result.get("task_id") if isinstance(result, dict) else None
                if task_id:
                    family["pending"][token] = task_id
                else:
                    family["pending"].pop(token, None)


def sound_files():
    """IDs resolve only to files discovered in the OS sound directory."""
    system = platform.system()
    if system == "Darwin":
        folder, suffix = Path("/System/Library/Sounds"), ".aiff"
    elif system == "Windows":
        folder, suffix = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Media", ".wav"
    elif system == "Linux":
        folder, suffix = Path("/usr/share/sounds/freedesktop/stereo"), ".oga"
    else:
        return {}
    return {
        path.stem: path for path in sorted(folder.glob(f"*{suffix}")) if path.is_file()
    }


def scaled_wave(path, volume):
    """Scale PCM samples without changing Windows' global device volume."""
    with wave.open(str(path), "rb") as source:
        params = source.getparams()
        if params.sampwidth not in (1, 2, 3, 4) or params.comptype != "NONE":
            raise ValueError("Unsupported Windows system WAV format")
        if params.nframes * params.nchannels * params.sampwidth > 10 * 1024 * 1024:
            raise ValueError("System sound file is too large")
        frames = bytearray(source.readframes(params.nframes))
    width = params.sampwidth
    for offset in range(0, len(frames), width):
        sample = int.from_bytes(
            frames[offset : offset + width], "little", signed=width != 1
        )
        if width == 1:
            sample -= 128
        sample = round(sample * volume / 100)
        if width == 1:
            sample += 128
        frames[offset : offset + width] = sample.to_bytes(
            width, "little", signed=width != 1
        )
    output = io.BytesIO()
    with wave.open(output, "wb") as destination:
        destination.setparams(params)
        destination.writeframes(frames)
    return output.getvalue()


def play_system_sound(event, selected="default", volume=100):
    """Blocking OS call; used only by our worker or the standalone test CLI."""
    if event not in EVENTS:
        raise ValueError(f"Unknown sound event: {event}")
    if type(volume) is not int or not 0 <= volume <= 100:
        raise ValueError("Volume must be an integer from 0 to 100")
    files = sound_files()
    if selected != "default" and selected not in files:
        raise ValueError("This system sound is not available")
    if volume == 0:
        return
    system = platform.system()
    if system == "Windows":
        import winsound

        name = (
            "Windows Notify System Generic"
            if event == "completion"
            else "Windows Exclamation"
        )
        path = files.get(selected if selected != "default" else name)
        if path is None and selected == "default":
            path = next(iter(files.values()), None)
        if path is None:
            raise RuntimeError("No Windows system WAV sounds available")
        winsound.PlaySound(
            scaled_wave(path, volume), winsound.SND_MEMORY | winsound.SND_NODEFAULT
        )
        return
    if system == "Darwin":
        sound = (
            selected
            if selected != "default"
            else ("Glass" if event == "completion" else "Ping")
        )
        command = ["/usr/bin/afplay", "-v", str(volume / 100), str(files[sound])]
    elif system == "Linux":
        sound = (
            selected
            if selected != "default"
            else ("complete" if event == "completion" else "dialog-warning")
        )
        executable = shutil.which("canberra-gtk-play")
        if executable:
            command = [
                executable,
                "--id",
                sound,
                "--volume",
                str(20 * math.log10(volume / 100)),
            ]
        else:
            executable = shutil.which("paplay")
            filename = Path(f"/usr/share/sounds/freedesktop/stereo/{sound}.oga")
            if not executable or not filename.is_file():
                raise RuntimeError(
                    "Linux needs canberra-gtk-play and a sound theme, or "
                    "paplay with freedesktop sound files, plus a desktop audio session",
                )
            command = [
                executable,
                f"--volume={round(volume / 100 * 65536)}",
                str(filename),
            ]
    else:
        raise RuntimeError(f"Unsupported operating system: {system}")
    subprocess.run(
        command,
        check=True,
        timeout=5,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


class SoundWorker:
    """Bounded FIFO keeps native audio off the agent's event loop."""

    def __init__(self, player=play_system_sound):
        self.player = player
        self.pending = queue.Queue(maxsize=16)
        self.stopped = threading.Event()
        self.thread = threading.Thread(
            target=self._run,
            name="qwenpaw-system-sound",
            daemon=True,
        )

    def start(self):
        self.thread.start()

    def submit(self, event):
        if self.stopped.is_set():
            return
        try:
            self.pending.put_nowait(event)
        except queue.Full:
            LOG.warning("Sound queue full; skipped %s notification", event)

    def close(self):
        # Do not block shutdown or play queued stale notifications after unload.
        self.stopped.set()

    def _run(self):
        while not self.stopped.is_set():
            try:
                event = self.pending.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                if not self.stopped.is_set():
                    self.player(event)
            except Exception:
                LOG.warning("Could not play %s sound", event, exc_info=True)
            finally:
                self.pending.task_done()


class SystemSoundPlugin:
    def __init__(self):
        self.worker = None
        self.enabled = dict.fromkeys(EVENTS, True)
        self.active = False
        self.patches = []
        self.generation = None
        self.api = None
        self.hooks = []
        self.settings_lock = threading.RLock()
        self.settings_path = None
        self.preferences = self.default_settings()
        self.collaboration = CollaborationTracker()

    @staticmethod
    def default_settings():
        return {
            "completion": {"enabled": True, "sound": "default"},
            "approval": {"enabled": True, "sound": "default"},
            "volume": 100,
            "root_only": True,
        }

    def validate_settings(self, data):
        if not isinstance(data, dict) or set(data) != {*EVENTS, "volume", "root_only"}:
            raise ValueError("设置格式已更新，请刷新设置页面后重试")
        if type(data["root_only"]) is not bool:
            raise ValueError("仅主任务完成提醒必须为开关值")
        if type(data["volume"]) is not int or not 0 <= data["volume"] <= 100:
            raise ValueError("音量必须是 0 到 100 的整数")
        available = {"default", *sound_files()}
        for event in EVENTS:
            item = data[event]
            if not isinstance(item, dict) or set(item) != {"enabled", "sound"}:
                raise ValueError("每种提醒必须包含 enabled 和 sound")
            if type(item["enabled"]) is not bool or not isinstance(item["sound"], str):
                raise ValueError("提醒开关或铃声格式不正确")
            if item["sound"] not in available:
                raise ValueError("所选铃声在当前系统中不可用，请重新选择")
        return json.loads(json.dumps(data))

    def load_settings(self):
        from qwenpaw.constant import WORKING_DIR

        if self.settings_path is None:
            self.settings_path = (
                Path(WORKING_DIR) / "plugin_settings" / "system-sound.json"
            )
        if self.settings_path.exists():
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
            data.setdefault("root_only", True)
            # Moving settings between operating systems keeps switches/volume.
            for event in EVENTS:
                if isinstance(data.get(event), dict) and data[event].get(
                    "sound"
                ) not in {"default", *sound_files()}:
                    data[event]["sound"] = "default"
        else:
            legacy = json.loads(Path(__file__).with_name("settings.json").read_text())
            data = self.default_settings()
            for event in EVENTS:
                if type(legacy.get(event)) is bool:
                    data[event]["enabled"] = legacy[event]
        self.save_settings(data)

    def save_settings(self, data):
        validated = self.validate_settings(data)
        with self.settings_lock:
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    dir=self.settings_path.parent,
                    delete=False,
                ) as output:
                    temporary = Path(output.name)
                    json.dump(validated, output, ensure_ascii=False, indent=2)
                os.replace(temporary, self.settings_path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            self.preferences = validated
            self.enabled = {event: validated[event]["enabled"] for event in EVENTS}

    def settings_snapshot(self):
        with self.settings_lock:
            return json.loads(json.dumps(self.preferences))

    def play_notification(self, event):
        current = self.settings_snapshot()
        if self.active and current[event]["enabled"]:
            play_system_sound(event, current[event]["sound"], current["volume"])

    def build_router(self):
        from fastapi import APIRouter, HTTPException

        router = APIRouter()
        preview_lock = asyncio.Lock()

        def require_active():
            if not self.active:
                raise HTTPException(503, "提示音插件尚未启动，请检查服务日志")

        @router.get("/settings")
        def get_settings():
            require_active()
            return {
                "settings": self.settings_snapshot(),
                "system": platform.system(),
                "sounds": [{"value": "default", "label": "系统默认"}]
                + [{"value": name, "label": name} for name in sound_files()],
            }

        @router.put("/settings")
        def update_settings(data: dict):
            require_active()
            try:
                self.save_settings(data)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            except OSError as error:
                LOG.warning("Could not save sound settings", exc_info=True)
                raise HTTPException(500, "设置保存失败，请检查数据目录权限") from error
            return {"settings": self.settings_snapshot()}

        @router.post("/preview")
        async def preview(data: dict):
            require_active()
            event = data.get("event")
            if event not in EVENTS or set(data) != {"event", "sound", "volume"}:
                raise HTTPException(422, "试听参数不正确")
            candidate = self.default_settings()
            candidate[event]["sound"] = data["sound"]
            candidate["volume"] = data["volume"]
            try:
                self.validate_settings(candidate)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            if preview_lock.locked():
                raise HTTPException(429, "正在试听，请稍后再试")
            async with preview_lock:
                try:
                    await asyncio.to_thread(
                        play_system_sound, event, data["sound"], data["volume"]
                    )
                except Exception as error:
                    LOG.warning("Sound preview failed", exc_info=True)
                    raise HTTPException(
                        503, "播放失败，请检查系统音频设备和服务日志"
                    ) from error
            return {"ok": True}

        return router

    def register(self, api):
        from qwenpaw.runtime.hooks import HookBase, HookResult
        from qwenpaw.runtime.phases import Phase

        owner = self
        self.api = api
        # Preserve in-flight families across hot updates of this plugin.
        from qwenpaw.plugins.registry import PluginRegistry

        registry = getattr(api, "_registry", None)
        if isinstance(registry, PluginRegistry):
            existing = getattr(registry, "_system_sound_collaboration", None)
            if existing is not None:
                self.collaboration = existing
            else:
                registry._system_sound_collaboration = self.collaboration
        suffix = uuid.uuid4().hex

        class RunStarted(HookBase):
            phase = Phase.PRE_DISPATCH
            name = f"system_sound_run_started_{suffix}"
            priority = -10000

            async def run(self, ctx):
                if owner.active:
                    try:
                        owner.collaboration.enter(ctx)
                    except Exception:
                        LOG.warning(
                            "Could not track collaboration start", exc_info=True
                        )
                return HookResult()

        class ResponseReady(HookBase):
            phase = Phase.POST_RESPONSE
            name = f"system_sound_response_ready_{suffix}"
            priority = 10000

            async def run(self, ctx):
                if owner.active and ctx.agent is not None:
                    ctx.extras[MARKER] = True
                    try:
                        ctx.extras[ROOT_READY] = owner.collaboration.can_finish(ctx)
                    except Exception:
                        ctx.extras[ROOT_READY] = False
                        LOG.warning(
                            "Could not confirm root response readiness", exc_info=True
                        )
                return HookResult()

        class Completion(HookBase):
            phase = Phase.FINALLY
            name = f"system_sound_completion_{suffix}"
            priority = 10000

            async def run(self, ctx):
                ready = ctx.extras.pop(MARKER, False)
                root_ready = ctx.extras.pop(ROOT_READY, False)
                try:
                    root_settled = owner.collaboration.leave(ctx)
                except Exception:
                    root_settled = False
                    LOG.warning(
                        "Could not confirm collaboration completion", exc_info=True
                    )
                root_only = owner.settings_snapshot()["root_only"]
                if (
                    owner.active
                    and ready
                    and ctx.error is None
                    and (not root_only or (root_ready and root_settled))
                ):
                    owner.notify("completion")
                return HookResult()

        self.hooks = [RunStarted(), ResponseReady(), Completion()]
        for hook in self.hooks:
            api.register_runtime_hook(hook)
        api.register_startup_hook("system_sound_start", self.start, priority=90)
        api.register_shutdown_hook("system_sound_stop", self.stop)
        api.register_uninstall_hook("system_sound_uninstall", self.stop)
        api.register_http_router(
            self.build_router(), prefix="/system-sound", tags=["system-sound"]
        )

    def notify(self, event):
        # Notification failure must never fail the task or approval itself.
        try:
            if self.active and self.enabled[event] and self.worker is not None:
                self.worker.submit(event)
        except Exception:
            LOG.warning("Sound notification failed", exc_info=True)

    def start(self):
        if self.active:
            return
        self.load_settings()
        self.generation = object()
        self.worker = SoundWorker(self.play_notification)
        try:
            # Always observe approvals, including when enabled later in the UI.
            self._patch_approvals()
            self._patch_delegation()
            self.worker.start()
            self.active = True
        except Exception:
            self.stop()
            raise
        LOG.info("System Sound started: %s", self.enabled)

    def _patch_delegation(self):
        from qwenpaw.agents.tools import agent_management

        for name in (
            "stream_agent_chat",
            "collect_final_agent_chat_response",
            "collect_final_agent_chat_response_async",
            "submit_agent_chat_task",
        ):
            original = getattr(agent_management, name, None)
            if original is None:  # async foreground collector was added after 2.0
                continue
            wrapper = self._delegation_wrapper(
                original, name == "submit_agent_chat_task"
            )
            self.patches.append((agent_management, name, original, wrapper))
            setattr(agent_management, name, wrapper)

    def _delegation_wrapper(self, original, background):
        generation = self.generation

        def prepare(args, kwargs):
            if not self.active or self.generation is not generation:
                return args, kwargs, None
            try:
                return self.collaboration.prepare_call(
                    original, args, kwargs, background
                )
            except Exception:
                self.collaboration.mark_uncertain()
                LOG.warning("Could not track delegated call", exc_info=True)
                return args, kwargs, None

        def finish(handle, result):
            try:
                self.collaboration.finish_call(handle, result)
            except Exception:
                self.collaboration.mark_uncertain()
                LOG.warning("Could not track delegated result", exc_info=True)

        if inspect.iscoroutinefunction(original):

            @functools.wraps(original)
            async def wrapped(*args, **kwargs):
                args, kwargs, handle = prepare(args, kwargs)
                result = None
                try:
                    result = await original(*args, **kwargs)
                    return result
                finally:
                    finish(handle, result)

        else:

            @functools.wraps(original)
            def wrapped(*args, **kwargs):
                args, kwargs, handle = prepare(args, kwargs)
                result = None
                try:
                    result = original(*args, **kwargs)
                    return result
                finally:
                    finish(handle, result)

        return wrapped

    def _patch_approvals(self):
        from qwenpaw.app.approvals.service import ApprovalService

        # Both legacy tool guard and generic governance/plugin approvals matter.
        # Keep originals in each closure; never dereference a mutable global.
        for name in ("create_pending", "create_pending_summary"):
            original = getattr(ApprovalService, name)
            wrapper = self._approval_wrapper(original)
            self.patches.append((ApprovalService, name, original, wrapper))
            setattr(ApprovalService, name, wrapper)

    def _approval_wrapper(self, original):
        generation = self.generation

        @functools.wraps(original)
        async def wrapped(service, *args, **kwargs):
            pending = await original(service, *args, **kwargs)
            if self.generation is generation:
                self.notify("approval")
            return pending

        return wrapped

    def stop(self, **_kwargs):
        self.active = False
        if self.worker is not None:
            self.worker.close()
            self.worker = None
        for cls, name, original, wrapper in reversed(self.patches):
            # Preserve wrappers installed later by another plugin. Our retained
            # inner wrapper becomes inert because this instance is inactive.
            if getattr(cls, name) is wrapper:
                setattr(cls, name, original)
        self.patches.clear()
        # QwenPaw 2.2.1b2 does not yet expose runtime-hook unregister.
        # Remove only our exact objects, and invalidate the sorted cache.
        # Unique hook names and active guards also make any detached old
        # workspace safe if the host no longer exposes it here.
        if self.api is not None:
            try:
                for workspace in self.api._get_all_workspaces():
                    registry = workspace.plugins.hook_registry
                    for phase, hooks in registry._by_phase.items():
                        registry._by_phase[phase] = [
                            hook
                            for hook in hooks
                            if not any(hook is owned for owned in self.hooks)
                        ]
                    registry._sorted_cache.clear()
            except Exception:
                LOG.warning("Could not remove inactive sound hooks", exc_info=True)


plugin = SystemSoundPlugin()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Play a local system test sound")
    parser.add_argument("--test", choices=EVENTS, required=True)
    arguments = parser.parse_args()
    play_system_sound(arguments.test)
    print(f"System sound command completed: {arguments.test}")
