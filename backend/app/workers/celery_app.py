from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "mockinterview",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_time_limit=300,
    timezone="UTC",
    enable_utc=True,
)

import app.workers.tasks  # noqa: F401  (register tasks)
