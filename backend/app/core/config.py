from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


_INSECURE_JWT_SECRETS = frozenset({
    "",
    "change-me",
    "change-me-to-a-long-random-string",
    "secret",
    "your-secret-here",
})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # --- Environment ---
    # Production deploys MUST set ENV=production; this gates the JWT_SECRET
    # validation below so a forgotten override fails fast at startup
    # instead of silently signing tokens with a publicly known secret.
    ENV: Literal["development", "staging", "production"] = "development"

    # --- Database ---
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/mockinterview"
    REDIS_URL: str = "redis://localhost:6379/0"

    # --- JWT ---
    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    PASSWORD_RESET_EXPIRE_MINUTES: int = 60

    # --- LLM Provider (pluggable) ---
    LLM_PROVIDER: Literal["groq", "openai"] = "groq"
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # --- Speech services ---
    DEEPGRAM_API_KEY: str = ""

    # TTS provider: "elevenlabs" or "openai"
    TTS_PROVIDER: Literal["elevenlabs", "openai"] = "elevenlabs"

    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"

    # OpenAI TTS (used when TTS_PROVIDER=openai)
    OPENAI_TTS_MODEL: str = "tts-1"  # or "tts-1-hd" for higher quality
    OPENAI_TTS_VOICE: str = "alloy"  # alloy, echo, fable, onyx, nova, shimmer

    # --- Google OAuth ---
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # --- S3 / MinIO ---
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    S3_BUCKET: str = "mockinterview"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_REGION: str = "us-east-1"

    # --- SMTP ---
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_FROM: str = "noreply@mockinterview.local"
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""

    # --- App ---
    CORS_ORIGINS: str = "http://localhost:5173"
    FRONTEND_URL: str = "http://localhost:5173"
    API_V1_PREFIX: str = "/api/v1"
    PROJECT_NAME: str = "AI Mock Interview"

    # --- Invitations ---
    INVITE_EXPIRY_HOURS: int = 24
    INVITE_MAX_ATTEMPTS: int = 1

    # --- Observability ---
    SENTRY_DSN: str = ""
    LOG_LEVEL: str = "INFO"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    def assert_jwt_secret_is_safe(self) -> None:
        """Refuse to boot a non-development app with a placeholder JWT secret.

        Any value in `_INSECURE_JWT_SECRETS` is treated as a forgotten default
        and short-circuits startup in staging/production. Development still
        boots (with a loud warning) so local dev / pytest don't break.
        """
        is_insecure = (
            self.JWT_SECRET in _INSECURE_JWT_SECRETS
            or len(self.JWT_SECRET) < 16
        )
        if not is_insecure:
            return
        if self.ENV == "development":
            import logging

            logging.getLogger(__name__).warning(
                "JWT_SECRET is set to a known-insecure placeholder (%r). "
                "This is OK in development but MUST be replaced with a "
                "long random string before deploying.",
                self.JWT_SECRET,
            )
            return
        raise RuntimeError(
            f"JWT_SECRET is insecure ({self.JWT_SECRET!r}). "
            "Set JWT_SECRET to a long random string (>=16 chars) before "
            f"running with ENV={self.ENV}."
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
