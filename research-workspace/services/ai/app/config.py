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
    mistral_model: str = "mistral-small-latest"
    llama_model: str = "llama-3.1-8b-instant"

    contact_email: str = ""

    # --- LLM providers. Model A: mistral | ollama. Model B: groq | ollama. ---
    # NOTE: mistral/groq are cloud APIs; chunk text (including confidential Mode B
    # documents) is sent to them. Use "ollama" for fully local processing.
    model_a_provider: str = "mistral"
    model_b_provider: str = "groq"
    mistral_base_url: str = "https://api.mistral.ai/v1"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model_a: str = "mistral-small:24b"
    ollama_model_b: str = "llama3.1:8b"
    llm_timeout_s: float = 120.0

    # Shared secret between the Go gateway and this service. Requests without it
    # are rejected, so user identity headers can only come from the gateway.
    internal_token: str = ""

    embedding_model: str = "BAAI/bge-base-en-v1.5"
    max_pdf_mb: int = 50
    embedding_dim: int = 768
    similarity_threshold: float = 0.01
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
