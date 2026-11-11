"""LLM clients. Mistral, Groq and Ollama all expose an OpenAI-compatible
/chat/completions API, so one client covers cloud and fully local deployments."""
import asyncio
from typing import Protocol

import httpx

from ..config import Settings

RETRY_STATUS = {429, 500, 502, 503, 504}


class LLMError(Exception):
    """The model could not be reached or returned an unusable response."""


class LLM(Protocol):
    name: str

    async def complete(self, system: str, user: str) -> str: ...


class OpenAICompatLLM:
    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout: float = 120.0,
        retries: int = 5,
        backoff: float = 2.5,
        client: httpx.AsyncClient | None = None,
    ):
        self.name = name
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self._client = client

    async def complete(self, system: str, user: str) -> str:
        payload = {
            "model": self.model,
            "temperature": 0,                      # deterministic, reproducible audits
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

        for attempt in range(self.retries):
            last = attempt == self.retries - 1
            try:
                if self._client is not None:
                    r = await self._client.post(self.url, json=payload, headers=headers)
                else:
                    async with httpx.AsyncClient(timeout=self.timeout) as c:
                        r = await c.post(self.url, json=payload, headers=headers)
            except httpx.TransportError as e:
                if last:
                    raise LLMError(f"{self.name}: {e.__class__.__name__}") from e
                await asyncio.sleep(self.backoff * 2**attempt)
                continue

            if r.status_code in RETRY_STATUS and not last:
                await asyncio.sleep(self.backoff * 2**attempt)
                continue
            if r.status_code != 200:
                # Truncate: provider error bodies can echo parts of the prompt.
                raise LLMError(f"{self.name}: HTTP {r.status_code} {r.text[:200]}")
            try:
                return r.json()["choices"][0]["message"]["content"] or ""
            except (KeyError, IndexError, ValueError) as e:
                raise LLMError(f"{self.name}: malformed response") from e
        raise LLMError(f"{self.name}: retries exhausted")


def build_llms(s: Settings) -> tuple[LLM, LLM]:
    """Model A (Lead Research Scientist) and Model B (Speed Auditor)."""

    def need_key(key: str, var: str) -> str:
        if not key:
            raise LLMError(f"{var} is not set")
        return key

    if s.model_a_provider == "mistral":
        a = OpenAICompatLLM(
            name="model_a:mistral", base_url=s.mistral_base_url, model=s.mistral_model,
            api_key=need_key(s.mistral_api_key, "MISTRAL_API_KEY"), timeout=s.llm_timeout_s,
        )
    elif s.model_a_provider == "groq":
        a = OpenAICompatLLM(
            name="model_a:groq", base_url=s.groq_base_url, model=s.mistral_model or "qwen/qwen3.8-27b",
            api_key=need_key(s.groq_api_key, "GROQ_API_KEY"), timeout=s.llm_timeout_s,
        )
    elif s.model_a_provider == "ollama":
        a = OpenAICompatLLM(
            name="model_a:ollama", base_url=s.ollama_base_url, model=s.ollama_model_a,
            timeout=s.llm_timeout_s,
        )
    else:
        raise LLMError(f"unknown MODEL_A_PROVIDER {s.model_a_provider!r}")

    if s.model_b_provider == "groq":
        b = OpenAICompatLLM(
            name="model_b:groq", base_url=s.groq_base_url, model=s.llama_model,
            api_key=need_key(s.groq_api_key, "GROQ_API_KEY"), timeout=s.llm_timeout_s,
        )
    elif s.model_b_provider == "mistral":
        b = OpenAICompatLLM(
            name="model_b:mistral", base_url=s.mistral_base_url, model="ministral-8b-latest",
            api_key=need_key(s.mistral_api_key, "MISTRAL_API_KEY"), timeout=s.llm_timeout_s,
        )
    elif s.model_b_provider == "ollama":
        b = OpenAICompatLLM(
            name="model_b:ollama", base_url=s.ollama_base_url, model=s.ollama_model_b,
            timeout=s.llm_timeout_s,
        )
    else:
        raise LLMError(f"unknown MODEL_B_PROVIDER {s.model_b_provider!r}")
    return a, b
