"""Models format free-text fields differently; the parser must accept the harmless variants."""
import json
from uuid import uuid4

from app.orchestration.schema import parse_answer

CID = uuid4()
ALIASES = {"C1": CID}


def _answer(conditions=None, notes=None):
    return json.dumps({
        "status": "answered",
        "claims": [{"text": "It was stable.", "cites": ["C1"], "quote": "was stable for twelve weeks", "conditions": conditions}],
        "notes": notes,
    })


def test_conditions_as_plain_string_is_unchanged():
    p = parse_answer(_answer("stored at 4 C"), ALIASES)
    assert p.claims[0].conditions == "stored at 4 C"


def test_conditions_as_list_is_joined():
    p = parse_answer(_answer(["stored at 4 C", "twelve weeks"]), ALIASES)
    assert p.claims[0].conditions == "stored at 4 C; twelve weeks"


def test_conditions_as_object_is_flattened():
    p = parse_answer(_answer({"temperature": "4 C", "duration": "twelve weeks"}), ALIASES)
    assert p.claims[0].conditions == "temperature: 4 C; duration: twelve weeks"


def test_conditions_as_number_and_null_and_empty_list():
    assert parse_answer(_answer(12), ALIASES).claims[0].conditions == "12"
    assert parse_answer(_answer(None), ALIASES).claims[0].conditions is None
    assert not parse_answer(_answer([]), ALIASES).claims[0].conditions     # empty -> no condition


def test_notes_as_list_is_accepted():
    p = parse_answer(_answer(notes=["a", "b"]), ALIASES)
    assert p.notes == "a; b"
