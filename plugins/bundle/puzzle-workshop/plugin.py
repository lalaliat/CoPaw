"""Puzzle Workshop demo. All mutations are explicit, reversible plugin toggles.

No core patches. Native lifecycle compatibility is confined to NativeLifecycle.
"""
from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
import hashlib
import json
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool

PLUGIN_ID = "puzzle-workshop"
ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$")


class SaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(min_length=1, max_length=128)
    changes: dict[str, StrictBool] = Field(max_length=100)


class NativeLifecycle:
    """Use the host's lifecycle; never uninstall or remove plugin files."""

    def __init__(self, request):
        self.request = request
        self.loader = request.app.state.plugin_loader

    async def enable(self, folder):
        from qwenpaw.plugins.architecture import PluginManifest
        from qwenpaw.app.routers.plugins import _post_load_setup

        manifest = PluginManifest.from_dict(json.loads((folder / "plugin.json").read_text()))
        record = await self.loader.load_plugin(manifest, folder)
        if not record.enabled:
            # Incompatible records must not be treated as successful activation.
            await self.loader.unload_plugin(manifest.id, delete_files=False)
            raise RuntimeError("插件不兼容：" + "; ".join(record.diagnostics))
        await _post_load_setup(self.request, manifest.id)

    async def disable(self, plugin_id):
        from qwenpaw.app.routers.plugins import (
            _collect_plugin_runtime_ids,
            _post_unload_cleanup,
        )
        if self.loader.get_loaded_plugin(plugin_id) is None:
            return
        providers, commands = _collect_plugin_runtime_ids(self.loader.registry, plugin_id)
        await self.loader.unload_plugin(plugin_id, delete_files=False)
        _post_unload_cleanup(self.request, plugin_id, providers, commands)

    async def reload_agents(self):
        from qwenpaw.app.routers.plugins import _schedule_all_agents_reload
        await _schedule_all_agents_reload(self.request)


class Workshop:
    def __init__(self, root_factory=None, lifecycle_factory=NativeLifecycle):
        self.root_factory = root_factory
        self.lifecycle_factory = lifecycle_factory
        self.lock = asyncio.Lock()

    def root(self):
        if self.root_factory:
            return Path(self.root_factory()).resolve()
        from qwenpaw.config.utils import get_plugins_dir
        return get_plugins_dir().resolve()

    def inventory(self, loader):
        root = self.root()
        rows = []
        warnings = []
        if root.exists():
            for folder in sorted(root.iterdir()):
                if folder.name.startswith(".") or not folder.is_dir():
                    continue
                if folder.is_symlink():
                    warnings.append(f"跳过链接目录：{folder.name}")
                    continue
                manifest_file = folder / "plugin.json"
                if not manifest_file.exists():
                    continue
                if manifest_file.is_symlink():
                    warnings.append(f"跳过链接清单：{folder.name}")
                    continue
                try:
                    manifest = json.loads(manifest_file.read_text())
                    pid = manifest.get("id", "")
                    if not isinstance(pid, str) or not ID_RE.fullmatch(pid):
                        raise ValueError("invalid id")
                    if folder.name not in (pid, pid + ".disabled"):
                        raise ValueError("folder/id mismatch")
                    record = loader.get_loaded_plugin(pid)
                    parked = folder.name.endswith(".disabled")
                    loaded = bool(record and record.enabled)
                    reason = "工坊自身保留，避免失去操作入口" if pid == PLUGIN_ID else ""
                    if (root / pid).exists() and (root / (pid + ".disabled")).exists():
                        reason = "发现重复目录，请先在插件管理中处理"
                    if not parked and not loaded:
                        reason = "插件未成功加载，请先在插件管理中修复"
                    if parked and loaded:
                        reason = "磁盘与运行状态不一致，请先刷新或重启"
                    if record and Path(record.source_path).resolve() != folder.resolve():
                        reason = "插件来自其他目录，暂不支持在工坊启停"
                    rows.append({
                        "id": pid,
                        "name": str(manifest.get("name", pid)),
                        "description": str(manifest.get("description", "")),
                        "version": str(manifest.get("version", "")),
                        "type": str(manifest.get("type", "general")),
                        "enabled": loaded and not parked,
                        "locked": bool(reason), "reason": reason,
                        "stamp": manifest_file.stat().st_mtime_ns,
                    })
                except (OSError, ValueError, TypeError) as exc:
                    warnings.append(f"无法读取插件 {folder.name}：{type(exc).__name__}")
        revision = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
        return {"plugins": rows, "revision": revision, "warnings": warnings}

    async def change(self, lifecycle, pid, enabled):
        root = self.root()
        active, parked = root / pid, root / (pid + ".disabled")
        if enabled:
            if active.exists() or not parked.is_dir() or parked.is_symlink():
                raise RuntimeError(f"{pid} 目录状态已变化")
            parked.rename(active)
            try:
                await lifecycle.enable(active)
            except Exception:
                # Undo partial registrations before parking the files again.
                await lifecycle.disable(pid)
                active.rename(parked)
                raise
        else:
            if parked.exists() or not active.is_dir() or active.is_symlink():
                raise RuntimeError(f"{pid} 目录状态已变化")
            await lifecycle.disable(pid)
            try:
                active.rename(parked)
            except Exception:
                await lifecycle.enable(active)
                raise

    async def save(self, request, payload):
        loader = getattr(request.app.state, "plugin_loader", None)
        if loader is None:
            raise HTTPException(503, "插件加载器尚未就绪")
        async with self.lock, AsyncExitStack() as stack:
            # Share the host's locks so install/uninstall cannot race this save.
            for pid in sorted(payload.changes):
                if not ID_RE.fullmatch(pid):
                    raise HTTPException(400, "无效插件 ID")
                await stack.enter_async_context(loader.plugin_lifecycle(pid))
            current = self.inventory(loader)
            if payload.revision != current["revision"]:
                raise HTTPException(409, "插件列表已变化，请刷新后重新调整")
            by_id = {p["id"]: p for p in current["plugins"]}
            todo = []
            for pid, enabled in payload.changes.items():
                row = by_id.get(pid)
                if row is None or row["locked"]:
                    raise HTTPException(400, (row or {}).get("reason", "插件不存在"))
                if enabled != row["enabled"]:
                    todo.append((pid, enabled))
            lifecycle = self.lifecycle_factory(request)
            completed = []
            try:
                for pid, enabled in todo:
                    await self.change(lifecycle, pid, enabled)
                    completed.append((pid, enabled))
            except Exception as exc:
                rollback_errors = []
                for pid, enabled in reversed(completed):
                    try:
                        await self.change(lifecycle, pid, not enabled)
                    except Exception as rollback:
                        rollback_errors.append(f"{pid}: {rollback}")
                await lifecycle.reload_agents()
                raise HTTPException(500, {
                    "message": f"保存失败：{exc}",
                    "rollback_errors": rollback_errors,
                    "state": self.inventory(loader),
                }) from exc
            if todo:
                await lifecycle.reload_agents()
            result = self.inventory(loader)
            return {**result, "applied": [pid for pid, _ in completed],
                    "message": "已保存，Agent 正在重新加载；刷新页面应用前端插件变化"}


workshop = Workshop()
router = APIRouter()


@router.get("/state")
async def state(request: Request):
    loader = getattr(request.app.state, "plugin_loader", None)
    if loader is None:
        raise HTTPException(503, "插件加载器尚未就绪")
    async with workshop.lock:
        return workshop.inventory(loader)


@router.post("/save")
async def save(payload: SaveRequest, request: Request):
    return await workshop.save(request, payload)


class PuzzlePlugin:
    def register(self, api):
        api.register_http_router(router, prefix="/puzzle-workshop", tags=["puzzle-workshop"])


plugin = PuzzlePlugin()
