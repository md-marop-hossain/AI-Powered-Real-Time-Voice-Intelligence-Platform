from contextlib import asynccontextmanager

import sentry_sdk
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.auth.routes import limiter, router as auth_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.core.storage import ensure_bucket
from app.interviews.routes import router as sessions_router
from app.interviews.websocket import router as ws_router
from app.invites.routes import router as invites_router
from app.resumes.routes import router as resumes_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    json_logs = settings.ENV != "development"
    configure_logging(log_level=settings.LOG_LEVEL, json_logs=json_logs)
    log = structlog.get_logger("app.startup")

    # Hard-fail in non-dev environments if JWT_SECRET is left as a placeholder.
    settings.assert_jwt_secret_is_safe()

    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENV,
            traces_sample_rate=0.1,
        )
        log.info("sentry_initialized", dsn_present=True)

    try:
        ensure_bucket()
    except Exception as e:
        log.warning("bucket_ensure_failed", error=str(e))
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "llm_provider": settings.LLM_PROVIDER, "model": settings.LLM_MODEL}


app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(resumes_router, prefix=settings.API_V1_PREFIX)
app.include_router(sessions_router, prefix=settings.API_V1_PREFIX)
app.include_router(invites_router, prefix=settings.API_V1_PREFIX)
app.include_router(ws_router)  # /ws/interview/{session_id}
