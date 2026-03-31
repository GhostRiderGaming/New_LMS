"""
conftest.py — shared pytest fixtures and sys.modules stubs.

Stubs out optional heavy dependencies (celery, fal_client, redis) so tests
can import app modules without those packages being installed.
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock


def _stub_module(name: str) -> MagicMock:
    """Create a MagicMock module and register it in sys.modules."""
    mock = MagicMock()
    mock.__name__ = name
    sys.modules[name] = mock
    return mock


# ---------------------------------------------------------------------------
# Stub celery and related packages if not installed
# ---------------------------------------------------------------------------
if "celery" not in sys.modules:
    celery_mock = _stub_module("celery")
    # Celery() constructor returns a mock app; task decorator returns the fn
    celery_app_mock = MagicMock()
    celery_mock.Celery.return_value = celery_app_mock
    _stub_module("celery.utils")
    _stub_module("celery.utils.log")

if "redis" not in sys.modules:
    _stub_module("redis")

# ---------------------------------------------------------------------------
# Stub fal_client if not installed
# ---------------------------------------------------------------------------
if "fal_client" not in sys.modules:
    _stub_module("fal_client")

# ---------------------------------------------------------------------------
# Now we can safely import app.worker — it will use the stubbed celery
# We pre-populate sys.modules['app.worker'] with a mock that has the
# task functions the routers need, so lazy `from app.worker import X`
# calls inside router functions get a patchable mock.
# ---------------------------------------------------------------------------
import importlib

# Build a mock worker module with all task functions
_worker_mock = MagicMock()
_worker_mock.generate_anime_task = MagicMock()
_worker_mock.generate_simulation_task = MagicMock()
_worker_mock.generate_model3d_task = MagicMock()
_worker_mock.generate_story_task = MagicMock()
_worker_mock.deliver_webhook = MagicMock()
_worker_mock.noop_task = MagicMock()

# Each task mock needs a .delay() method
for _task_name in [
    "generate_anime_task",
    "generate_simulation_task",
    "generate_model3d_task",
    "generate_story_task",
    "deliver_webhook",
    "noop_task",
]:
    getattr(_worker_mock, _task_name).delay = MagicMock(return_value=MagicMock(id="mock-task-id"))

sys.modules["app.worker"] = _worker_mock
