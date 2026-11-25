from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        extra="ignore",
        protected_namespaces=("settings_",),
    )
    # Role-based permissions. Off while everyone uses the same access key; switch on once sign-in is per person.
    role_restrictions: bool = False

    database_url: str = "postgresql://rw:rw_dev_password@localhost:5432/research_workspace"
    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "research-pdfs"
    s3_region: str = "us-east-1"

    mistral_api_key: str = ""
    groq_api_key: str = ""
    gemini_api_key: str = ""
    # Any other OpenAI-compatible service (an aggregator such as xKiro or OpenRouter, Together, DeepSeek ...):
    # provider "compat" with its API address, its key, and MODEL_<slot>_NAME as that service names the model.
    compat_base_url: str = ""
    compat_api_key: str = ""

    contact_email: str = ""

    # --- LLM models: swap providers or models by editing .env only (see .env.example). ---
    # Providers: mistral | groq | gemini | ollama | compat. An empty *_NAME uses the provider's default model
    # (compat has none: its model name must be set).
    model_a_name: str = ""
    model_b_name: str = ""
    # Optional backup per slot, used automatically when the main model's provider is overloaded, out of quota or
    # unreachable. Pick a different company from the other slot's model so the two checks stay independent.
    model_a_fallback_provider: str = ""
    model_a_fallback_name: str = ""
    model_b_fallback_provider: str = ""
    model_b_fallback_name: str = ""
    # NOTE: mistral/groq are cloud APIs; chunk text (including confidential Mode B
    # documents) is sent to them. Use "ollama" for fully local processing.
    model_a_provider: str = "mistral"
    model_b_provider: str = "groq"
    mistral_base_url: str = "https://api.mistral.ai/v1"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"   # Gemini's OpenAI-compatible API
    ollama_base_url: str = "http://localhost:11434/v1"
    llm_timeout_s: float = 120.0
    # Max source-text tokens sent to a model per question (0 = unlimited). Keeps requests under provider
    # per-minute token caps (e.g. Groq free tier: 8,000); the least relevant passages are dropped first.
    # Sized so source text (~4,200 real tokens) + prompts (~650) + llm_max_output_tokens stays under 8,000.
    llm_context_token_budget: int = 4000
    # Output tokens reserved per model call (0 = provider default, which may exceed small per-minute caps).
    llm_max_output_tokens: int = 2048
    # Evidence library (work package research): the top papers, read by both models. Separate from /ask so the
    # Q&A budget does not change. Sized for ~10 papers x 1 passage with a 8,000-token provider cap.
    evidence_context_token_budget: int = 5200
    evidence_passages_per_source: int = 1

    # Shared secret between the Go gateway and this service. Requests without it
    # are rejected, so user identity headers can only come from the gateway.
    internal_token: str = ""

    # "bge" (real semantic model) or "hash" (keyword hashing, tests/dev only).
    # There is no silent fallback: if bge cannot load, requests fail with 503.
    embedder: str = "bge"
    embedding_model: str = "BAAI/bge-base-en-v1.5"
    max_pdf_mb: int = 50
    embedding_dim: int = 768
    similarity_threshold: float = 0.76
    # Cross-check: True shows findings from different papers (or differing only in conditions) as differences
    # with citations instead of a disagreement. False restores the strict behaviour.
    judge_lenient: bool = True
    # Similarity gate for passages below similarity_threshold. "lenient" (default): the models still read them and
    # the quote check removes what the sources do not support. "strict": refused before any model is called.
    similarity_gate: Literal["strict", "lenient"] = "lenient"
    # Every completed chat is saved to the project as a work package (its evidence and overview). Off switch for ops.
    chat_work_packages: bool = True
    # Citation verifier (app/verification)
    fuzzy_threshold: float = 0.9
    min_quote_tokens: int = 3
    min_support: float = 0.7
    strict_numbers: bool = True
    chunk_tokens: int = 512
    chunk_overlap: int = 64


@lru_cache
def get_settings() -> Settings:
    return Settings()
