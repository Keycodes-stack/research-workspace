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
        max_tokens: int | None = None,
    ):
        self.name = name
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self._client = client
        self.max_tokens = max_tokens

    def _wait(self, r: httpx.Response, attempt: int) -> float:
        """Backoff, but never shorter than the provider's Retry-After (capped at 60 s).
        A 429 with no hint usually means a per-minute quota (e.g. 2 requests/min on a free tier): wait long
        enough for the minute to roll over instead of burning every retry in the first few seconds."""
        try:
            hint = float(r.headers.get("retry-after", 0))
        except ValueError:
            hint = 0.0
        wait = self.backoff * 2**attempt
        if r.status_code == 429 and hint <= 0 and self.backoff > 0:
            wait = max(wait, 25.0 * (attempt + 1))
        return max(wait, min(hint + 0.5, 60.0)) if hint > 0 else min(wait, 60.0)

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
        if "gpt-oss" in self.model:
            # Reasoning models can spend the whole output budget thinking and return an empty reply
            # (Groq: json_validate_failed). Low effort keeps the reply and uses fewer tokens per minute.
            payload["reasoning_effort"] = "low"
        if self.max_tokens:
            # Providers count prompt + reserved output against per-minute caps (Groq free tier: 8,000);
            # without an explicit cap the default reservation alone can push a request over the limit (HTTP 413).
            payload["max_tokens"] = self.max_tokens
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

            transient = r.status_code in RETRY_STATUS or (
                r.status_code == 400 and "json_validate_failed" in r.text)  # flaky empty JSON reply
            if transient and not last:
                await asyncio.sleep(self._wait(r, attempt))
                continue
            if r.status_code != 200:
                # Truncate: provider error bodies can echo parts of the prompt.
                raise LLMError(f"{self.name}: HTTP {r.status_code} {r.text[:200]}")
            try:
                return r.json()["choices"][0]["message"]["content"] or ""
            except (KeyError, IndexError, ValueError) as e:
                raise LLMError(f"{self.name}: malformed response") from e
        raise LLMError(f"{self.name}: retries exhausted")


# provider -> (base_url setting, api-key setting or None, API-key env var, default model for slot A / slot B)
PROVIDERS = {
    "mistral": ("mistral_base_url", "mistral_api_key", "MISTRAL_API_KEY", ("mistral-small-latest", "ministral-8b-latest")),
    "groq": ("groq_base_url", "groq_api_key", "GROQ_API_KEY", ("llama-3.3-70b-versatile", "llama-3.1-8b-instant")),
    "ollama": ("ollama_base_url", None, "", ("mistral-small:24b", "llama3.1:8b")),
}


def build_llm(s: Settings, slot: str) -> OpenAICompatLLM:
    """Build model A or B purely from settings: MODEL_<slot>_PROVIDER and MODEL_<slot>_NAME."""
    provider = getattr(s, f"model_{slot.lower()}_provider")
    if provider not in PROVIDERS:
        raise LLMError(f"unknown MODEL_{slot}_PROVIDER {provider!r}; use one of {sorted(PROVIDERS)}")
    url_attr, key_attr, key_var, defaults = PROVIDERS[provider]
    key = getattr(s, key_attr) if key_attr else ""
    if key_attr and not key:
        raise LLMError(f"{key_var} is not set")
    name = getattr(s, f"model_{slot.lower()}_name") or defaults[slot == "B"]
    return OpenAICompatLLM(
        name=f"model_{slot.lower()}:{provider}", base_url=getattr(s, url_attr), model=name,
        api_key=key, timeout=s.llm_timeout_s, max_tokens=s.llm_max_output_tokens or None,
    )


def build_llms(s: Settings) -> tuple[LLM, LLM]:
    """Model A (Lead Research Scientist) and Model B (Speed Auditor)."""
    return build_llm(s, "A"), build_llm(s, "B")
