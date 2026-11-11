import asyncio
import json

from tests.helpers import make_pool

INTERNAL_TOKEN = "test-internal-token"
USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"


def hdr(user: str = USER_A, token: str = INTERNAL_TOKEN) -> dict:
    return {"X-Internal-Token": token, "X-User-Id": user}


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body):
        self.objects[(Bucket, Key)] = Body


class ScriptedLLM:
    """Returns a fixed answer, or a fixed verdict when called as the cross-checker."""

    def __init__(self, name, answer, judge=None, error=None):
        self.name, self.answer, self.judge, self.error = name, answer, judge, error
        self.calls = []

    async def complete(self, system, user):
        self.calls.append((system, user))
        if self.error:
            raise self.error
        return self.judge if "cross-checker" in system else self.answer


def answer_json(text, quote, cite="C1", cond=None, status="answered"):
    return json.dumps({"status": status, "claims": [
        {"text": text, "cites": [cite], "quote": quote, "conditions": cond}]})


AGREED = json.dumps({"a_claims": [{"id": 1, "status": "agreed", "b_ids": [1]}], "conflicts": []})


def db_exec(url, fn):
    """Run `async fn(pool)` without truncating (for mid-test DB tampering/inspection)."""
    async def go():
        pool = await make_pool(url)
        try:
            return await fn(pool)
        finally:
            await pool.close()
    return asyncio.run(go())
