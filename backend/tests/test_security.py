from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip():
    h = hash_password("MyP@ssword1")
    assert verify_password("MyP@ssword1", h)
    assert not verify_password("wrong", h)


def test_access_token_roundtrip():
    tok = create_access_token("user-123")
    payload = decode_token(tok)
    assert payload is not None
    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"


def test_refresh_token_roundtrip():
    tok = create_refresh_token("user-123")
    payload = decode_token(tok)
    assert payload is not None
    assert payload["type"] == "refresh"
    assert "jti" in payload


def test_invalid_token_returns_none():
    assert decode_token("not-a-jwt") is None
