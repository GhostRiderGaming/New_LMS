"""
In-process task dispatcher — fallback when Celery/Redis is unavailable
or no Celery workers are running.

When Celery workers are not running, routers call ``dispatch_async()`` to run
generation coroutines directly in the FastAPI event loop.  This avoids
silently dropping jobs.

``has_celery_workers()`` pings the Celery control plane to see if any workers
are registered.  This check is cached for 60 seconds to avoid overhead.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Coroutine, Any

logger = logging.getLogger(__name__)

# Cache the Celery worker availability check
_celery_available: bool | None = None
_celery_checked_at: float = 0
_CELERY_CHECK_TTL = 60.0  # seconds


def has_celery_workers() -> bool:
    """
    Return True if at least one Celery worker is running and responding.

    The result is cached for 60 seconds to avoid hitting Redis on every request.
    If Redis itself is down, returns False immediately.
    """
    global _celery_available, _celery_checked_at

    now = time.monotonic()
    if _celery_available is not None and (now - _celery_checked_at) < _CELERY_CHECK_TTL:
        return _celery_available

    try:
        from app.worker import celery_app
        # ping() sends a broadcast and collects responses within the timeout
        result = celery_app.control.ping(timeout=1.0)
        _celery_available = len(result) > 0
    except Exception:
        _celery_available = False

    _celery_checked_at = now
    if not _celery_available:
        logger.info("No Celery workers detected — using in-process task execution")
    return _celery_available


def dispatch_async(coro: Coroutine[Any, Any, Any]) -> None:
    """
    Fire-and-forget an async coroutine in the current running event loop.

    This is the fallback execution path when Celery dispatch fails.
    The coroutine is expected to be one of the ``run_*_job`` functions
    from ``app.services.task_executor``.
    """
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(coro)
        # Add a callback to log unhandled exceptions from the task
        task.add_done_callback(_log_task_exception)
        logger.info("Dispatched background task: %s", coro.__qualname__)
    except RuntimeError:
        # No running event loop — shouldn't happen in FastAPI, but handle it
        logger.error("No running event loop — cannot dispatch async task")


def _log_task_exception(task: asyncio.Task) -> None:
    """Log any unhandled exception from a background task."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        logger.exception(
            "Background task %s raised: %s",
            task.get_name(),
            exc,
            exc_info=exc,
        )
