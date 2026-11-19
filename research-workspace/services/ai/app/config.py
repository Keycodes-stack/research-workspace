from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        extra="ignore",
        protected_namespaces=("settings_",),
    )

    database_url: str = "postgresql://rw:rw_dev_password@localhost:5432/research_workspace"
    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "research-pdfs"
    s3_region: str = "us-east-1"

    mistral_api_key: str = ""
    groq_api_key: str = ""

    contact_email: str = ""

    # --- LLM models: swap providers or models by editing .env only (see .env.example). ---
    # Providers: mistral | groq | ollama. An empty *_NAME uses the provider's default model.
    model_a_name: str = ""
    model_b_name: str = ""
    # NOTE: mistral/groq are cloud APIs; chunk text (including confidential Mode B
    # documents) is sent to them. Use "ollama" for fully local processing.
    model_a_provider: str = "mistral"
    model_b_provider: str = "groq"
    mistral_base_url: str = "https://api.mistral.ai/v1"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    ollama_base_url: str = "http://localhost:11434/v1"
    llm_timeout_s: float = 120.0
    # Max source-text tokens sent to a model per question (0 = unlimited). Keeps requests under provider
    # per-minute token caps (e.g. Groq free tier: 8,000); the least relevant passages are dropped first.
    # Sized so source text (~4,200 real tokens) + prompts (~650) + llm_max_output_tokens stays under 8,000.
    llm_context_token_budget: int = 4000
    # Output tokens reserved per model call (0 = provider default, which may exceed small per-minute caps).
    llm_max_output_tokens: int = 2048

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
