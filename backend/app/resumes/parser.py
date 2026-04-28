"""Resume text extraction (PDF / DOCX) + LLM-based field extraction + local embeddings."""

from __future__ import annotations

import io
import json
from functools import lru_cache

from pypdf import PdfReader
from docx import Document

from app.core.llm_provider import JSON_RESPONSE, get_llm_provider


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        return _extract_pdf(data)
    if name.endswith(".docx"):
        return _extract_docx(data)
    if name.endswith(".txt"):
        return data.decode("utf-8", errors="ignore")
    raise ValueError(f"Unsupported resume file type: {filename}")


def _extract_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    parts = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(parts).strip()


def _extract_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs).strip()


PARSE_SYSTEM = (
    "You are a resume parser. Given raw resume text, extract structured fields. "
    "Return strict JSON matching the schema. Do not invent information not present. "
    "If a field is missing, omit it or use null/empty list."
)

PARSE_USER_TEMPLATE = """Extract the following fields and return JSON only:
{{
  "full_name": string|null,
  "title": string|null,
  "summary": string|null,
  "skills": string[],
  "experience": [
    {{"company": string, "role": string, "start": string|null, "end": string|null, "highlights": string[]}}
  ],
  "education": [
    {{"institution": string, "degree": string|null, "year": string|null}}
  ],
  "projects": [{{"name": string, "description": string|null, "tech": string[]}}],
  "contact": {{"email": string|null, "phone": string|null, "location": string|null, "links": string[]}}
}}

Resume text:
\"\"\"
{text}
\"\"\""""


async def llm_extract_fields(text: str) -> dict:
    provider = get_llm_provider()
    truncated = text[:12000]
    raw = await provider.chat(
        messages=[
            {"role": "system", "content": PARSE_SYSTEM},
            {"role": "user", "content": PARSE_USER_TEMPLATE.format(text=truncated)},
        ],
        response_format=JSON_RESPONSE,
        temperature=0.0,
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}


@lru_cache(maxsize=1)
def _embedder():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def embed_text(text: str) -> list[float]:
    model = _embedder()
    vec = model.encode(text[:8000], normalize_embeddings=True)
    return vec.tolist()
