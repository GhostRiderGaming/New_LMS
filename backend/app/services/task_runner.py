"""
In-process task dispatcher — fallback when Celery/Redis is unavailable.

When the Celery broker is down, routers call ``dispatch_async()`` to run
generation coroutines directly in the FastAPI event loop. This avoids
silently dropping jobs.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Coroutine, Any

logger = logging.getLogger(__name__)


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
