"""
In-process pub/sub for real-time job status updates.

Subscribers (WebSocket connections) register an asyncio.Queue keyed by job_id.
When a Celery task calls `notify()`, all queues watching that job get a message.

This avoids the need for an external message broker for the WebSocket layer —
the notify() call can be made from the synchronous Celery context because it
only touches a thread-safe dict and uses `put_nowait()`.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import AsyncIterator

logger = logging.getLogger(__name__)

# job_id -> set of asyncio.Queue instances
_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def notify(job_id: str, payload: dict) -> None:
    """
    Broadcast a status update to all WebSocket subscribers watching this job.

    Safe to call from synchronous code (Celery tasks).  Messages are
    dropped silently if the queue is full (subscriber is too slow).
    """
    queues = _subscribers.get(job_id)
    if not queues:
        return
    for q in list(queues):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            logger.warning("Dropping job update for %s — subscriber queue full", job_id)


@asynccontextmanager
async def subscribe(job_id: str) -> AsyncIterator[asyncio.Queue]:
    """
    Context manager that yields an asyncio.Queue receiving updates for *job_id*.

    Usage::

        async with subscribe(job_id) as queue:
            while True:
                msg = await queue.get()
                await ws.send_json(msg)
    """
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subscribers[job_id].add(q)
    try:
        yield q
    finally:
        _subscribers[job_id].discard(q)
        if not _subscribers[job_id]:
            del _subscribers[job_id]
