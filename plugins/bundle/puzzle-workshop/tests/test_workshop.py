"""Lifecycle/state contracts; no real user plugins are modified."""
import asyncio
from contextlib import asynccontextmanager
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

spec = importlib.util.spec_from_file_location("puzzle_test_plugin", Path(__file__).parents[1] / "plugin.py")
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


class Loader:
    def __init__(self):
        self.records = {}
        self.locked = set()

    def get_loaded_plugin(self, pid):
        return self.records.get(pid)

    @asynccontextmanager
    async def plugin_lifecycle(self, pid):
        self.locked.add(pid)
        try:
            yield
        finally:
            self.locked.remove(pid)


@pytest.fixture
def setup(tmp_path):
    loader = Loader()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(plugin_loader=loader)))
    calls = []
    fail = set()

    class Lifecycle:
        async def enable(self, folder):
            pid = folder.name
            assert pid in loader.locked
            calls.append((pid, True))
            if (pid, True) in fail:
                raise RuntimeError("injected enable failure")
            loader.records[pid] = SimpleNamespace(enabled=True, source_path=folder)

        async def disable(self, pid):
            assert pid in loader.locked
            calls.append((pid, False))
            if (pid, False) in fail:
                raise RuntimeError("plugin in use")
            loader.records.pop(pid, None)

        async def reload_agents(self):
            calls.append(("reload", True))

    def install(pid, enabled=True):
        folder = tmp_path / (pid if enabled else pid + ".disabled")
        folder.mkdir()
        (folder / "plugin.json").write_text(json.dumps({"id": pid, "name": pid, "version": "1.0"}))
        (folder / "keep.txt").write_text("user data")
        if enabled:
            loader.records[pid] = SimpleNamespace(enabled=True, source_path=folder)
        return folder

    workshop = m.Workshop(lambda: tmp_path, lambda _: Lifecycle())
    return tmp_path, loader, request, calls, fail, install, workshop


def run(coro):
    return asyncio.run(coro)


def payload(ws, loader, changes):
    return m.SaveRequest(revision=ws.inventory(loader)["revision"], changes=changes)


def test_read_and_local_draft_do_not_mutate(setup):
    root, loader, req, calls, fail, install, ws = setup
    install("sample")
    draft = ws.inventory(loader)
    draft["plugins"][0]["enabled"] = False
    assert ws.inventory(loader)["plugins"][0]["enabled"] is True
    assert calls == []
    assert (root / "sample/keep.txt").read_text() == "user data"


def test_save_disable_enable_preserves_files_and_discovery(setup):
    root, loader, req, calls, fail, install, ws = setup
    install("sample")
    result = run(ws.save(req, payload(ws, loader, {"sample": False})))
    assert not result["plugins"][0]["enabled"]
    assert not (root / "sample").exists()
    assert (root / "sample.disabled/keep.txt").read_text() == "user data"
    result = run(ws.save(req, payload(ws, loader, {"sample": True})))
    assert result["plugins"][0]["enabled"]
    assert (root / "sample/keep.txt").read_text() == "user data"
    assert not (root / "sample.disabled").exists()


def test_stale_revision_rejected_before_mutation(setup):
    root, loader, req, calls, fail, install, ws = setup
    install("sample")
    p = payload(ws, loader, {"sample": False})
    install("new-plugin")
    with pytest.raises(HTTPException) as e:
        run(ws.save(req, p))
    assert e.value.status_code == 409
    assert calls == []


@pytest.mark.parametrize("pid", ["puzzle-workshop", "channels", "../sample"])
def test_self_demo_unknown_and_path_traversal_rejected(setup, pid):
    root, loader, req, calls, fail, install, ws = setup
    install("puzzle-workshop")
    with pytest.raises(HTTPException):
        run(ws.save(req, payload(ws, loader, {pid: False})))
    assert calls == []


def test_batch_failure_restores_previously_changed_plugin(setup):
    root, loader, req, calls, fail, install, ws = setup
    install("first")
    install("second")
    fail.add(("second", False))
    with pytest.raises(HTTPException) as e:
        run(ws.save(req, payload(ws, loader, {"first": False, "second": False})))
    assert e.value.detail["rollback_errors"] == []
    assert all(p["enabled"] for p in ws.inventory(loader)["plugins"])
    assert (root / "first/keep.txt").exists()


def test_failed_enable_restores_parked_files(setup):
    root, loader, req, calls, fail, install, ws = setup
    install("sample", False)
    fail.add(("sample", True))
    with pytest.raises(HTTPException):
        run(ws.save(req, payload(ws, loader, {"sample": True})))
    assert (root / "sample.disabled/keep.txt").exists()
    assert not (root / "sample").exists()


def test_duplicate_and_symlink_directories_are_not_writable(setup, tmp_path):
    root, loader, req, calls, fail, install, ws = setup
    install("sample")
    install("sample", False)
    assert all(p["locked"] for p in ws.inventory(loader)["plugins"])
    (root / "alias").symlink_to(root / "sample", target_is_directory=True)
    assert len(ws.inventory(loader)["plugins"]) == 2


def test_noop_save_does_not_reload(setup):
    root, loader, req, calls, fail, install, ws = setup
    install("sample")
    run(ws.save(req, payload(ws, loader, {"sample": True})))
    assert calls == []


def test_strict_input():
    with pytest.raises(ValidationError):
        m.SaveRequest(revision="x", changes={"sample": "false"})
    with pytest.raises(ValidationError):
        m.SaveRequest(revision="x", changes={}, demo={"channels": False})
