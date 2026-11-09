# -*- coding: utf-8 -*-
"""Workspace model selection and a credential-free catalog via real providers."""

from dataclasses import asdict
import json

import pytest

from qwenpaw.plugins import StaleContextError
from qwenpaw.plugins.commands import CommandResult, CommandSpec
from qwenpaw.plugins.messages import ContentBlock, Message
from qwenpaw.plugins.providers import ModelInfo, ProviderSpec, ModelChunk


async def test_workspace_choice_default_catalog_and_lifetime(sdk_component):
    retained = []

    def declare(ctx):
        async def generate(call, request):
            yield ModelChunk(is_last=True)

        for key in ("one", "two"):
            ctx.register_provider(
                ProviderSpec(
                    "selection-" + key,
                    "Provider " + key,
                    generate,
                    models=(ModelInfo("model-" + key, "Model " + key),),
                    require_api_key=False,
                ),
            )

        async def selection(call, args):
            service = call.models
            retained.append(service)
            current = await service.configured()
            data = {
                "selected": asdict(current) if current else None,
                "models": [asdict(item) for item in await service.catalog()],
            }
            return CommandResult(
                "reply",
                Message("assistant", (ContentBlock(text=json.dumps(data)),)),
            )

        ctx.register_command(CommandSpec("selection", selection))

    async with sdk_component(
        declare,
        capabilities=("providers", "commands", "models"),
    ) as (host, ctx):
        from qwenpaw.providers.provider_manager import (
            ProviderManager,
            ModelSlotConfig,
        )

        ProviderManager.get_instance().active_model = ModelSlotConfig(
            provider_id="selection-one",
            model="model-one",
        )
        await host.configure_chat_model(
            "selection-two",
            "model-two",
            workspace_id="two",
        )
        default = json.loads(
            (await host.call_command("/selection", workspace_id="one"))
            .content[0]
            .text,
        )
        custom = json.loads(
            (await host.call_command("/selection", workspace_id="two"))
            .content[0]
            .text,
        )
        assert default["selected"] == {
            "provider_id": "selection-one",
            "model_id": "model-one",
        }
        assert custom["selected"] == {
            "provider_id": "selection-two",
            "model_id": "model-two",
        }
        available = [
            item
            for item in custom["models"]
            if item["provider_id"].startswith("selection-")
        ]
        assert len(available) == 2
        assert available[0] == {
            "provider_id": "selection-one",
            "provider_name": "Provider one",
            "model_id": "model-one",
            "model_name": "Model one",
        }
        assert all(
            set(item)
            == {"provider_id", "provider_name", "model_id", "model_name"}
            for item in custom["models"]
        )
        with pytest.raises(StaleContextError):
            await retained[0].configured()
        with pytest.raises(StaleContextError):
            await retained[0].catalog()
