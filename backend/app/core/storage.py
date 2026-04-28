"""S3 / MinIO object storage helpers."""

from __future__ import annotations

import io
import logging
from functools import lru_cache

import boto3
from botocore.client import Config

from app.core.config import settings

log = logging.getLogger(__name__)


@lru_cache
def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4"),
    )


def ensure_bucket() -> None:
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=settings.S3_BUCKET)
    except Exception:
        client.create_bucket(Bucket=settings.S3_BUCKET)


def upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    client = get_s3_client()
    client.upload_fileobj(
        io.BytesIO(data),
        settings.S3_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return key


def download_bytes(key: str) -> bytes:
    client = get_s3_client()
    buf = io.BytesIO()
    client.download_fileobj(settings.S3_BUCKET, key, buf)
    return buf.getvalue()


def delete_object(key: str) -> None:
    """Best-effort delete of an object. Logs on failure but never raises."""
    if not key:
        return
    try:
        get_s3_client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
    except Exception as e:
        log.warning("Failed to delete S3 object %s: %s", key, e)


def presigned_url(key: str, expires_in: int = 3600) -> str:
    client = get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )
