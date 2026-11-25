"""If model A cannot judge, model B judges, so one provider's outage does not stop the cross-check."""
import asyncio

from app.ingest.chunking import sha256_hex
from app.orchestration.engine import run_dual
from app.orchestration.llm import LLMError
from app.orchestration.schema import ContextChunk
from tests.fakes import ScriptedLLM, answer_json

AGREED = '{"a_claims": [{"id": 1, "status": "agreed", "b_ids": [1]}], "conflicts": []}'


class JudgeDown(ScriptedLLM):
    """Answers normally, but fails whenever it is asked to judge."""

    async def complete(self, system, user):
        if "cross-checker" in system:
            raise LLMError(f"{self.name}: judge unavailable")
        return await super().complete(system, user)


def test_model_b_judges_when_model_a_cannot():
    text = "Stable at 4 C for twelve weeks."
    chunk = ContextChunk("C1", text, "Smith 2024", 3, 3, sha256_hex(text))
    answer = answer_json("Stable at 4 C", "Stable at 4 C")
    a = JudgeDown("A", answer)
    b = ScriptedLLM("B", answer, judge=AGREED)
    result = asyncio.run(run_dual("How long is it stable?", [chunk], a, b, judge=a))
    assert result.kind in ("consensus", "disagreement", "insufficient_evidence")
    assert any("cross-checker" in system for system, _ in b.calls), "model B should have judged"
