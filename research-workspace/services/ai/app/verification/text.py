"""Text helpers for deterministic verification: normalisation, tokens, numbers."""
import re
import unicodedata

_CHAR_MAP = str.maketrans({
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "−": "-",
    "­": None,            # soft hyphen
    " ": " ",
})


def normalize(text: str) -> str:
    """NFKC, tidy quotes/dashes, re-join words hyphenated across line breaks,
    collapse whitespace. Applied identically to quotes and source text."""
    t = unicodedata.normalize("NFKC", text).translate(_CHAR_MAP)
    t = re.sub(r"-\s*\n\s*(?=[a-z])", "", t)
    return re.sub(r"\s+", " ", t).strip()


_WORD = re.compile(r"[^\W\d_]+|\d+(?:[.,]\d+)*")


def tokens(text: str) -> list[str]:
    """Lower-cased word and number tokens (punctuation dropped)."""
    return [m.group().lower() for m in _WORD.finditer(text)]


# ---- numbers ---------------------------------------------------------------

# Digits not glued to letters before them (so H1N1, CD4, IL6 are ignored).
_NUM = re.compile(r"(?<![\w.,])\d+(?:[.,]\d+)*(?![.,]?\d)")

_ONES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
         "seventy": 70, "eighty": 80, "ninety": 90}
_COMPOUND = re.compile(
    rf"\b({'|'.join(_TENS)})[- ]({'|'.join(k for k in _ONES if 0 < _ONES[k] < 10)})\b")
_SINGLE = re.compile(rf"\b({'|'.join([*_ONES, *_TENS])})\b")


def canon_num(s: str) -> str:
    """'4.0' -> '4', '1,000' -> '1000', '0,5' -> '0.5' (so spellings compare equal)."""
    s = s.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", s) else s.replace(",", ".")
    try:
        return format(float(s), "g")
    except ValueError:
        return s


def numbers_in(text: str, *, skip_one: bool = False) -> set[str]:
    """Canonical numbers in text, including spelled-out ones ('twelve' -> '12').
    skip_one: ignore the word 'one' (usually a pronoun in claim text)."""
    t = normalize(text)
    found = {canon_num(m.group()) for m in _NUM.finditer(t)}
    low = t.lower()
    for m in _COMPOUND.finditer(low):
        found.add(str(_TENS[m.group(1)] + _ONES[m.group(2)]))
    low = _COMPOUND.sub(" ", low)
    for m in _SINGLE.finditer(low):
        w = m.group(1)
        if skip_one and w == "one":
            continue
        found.add(str(_ONES.get(w, _TENS.get(w))))
    return found


# ---- lexical support -----------------------------------------------------------

_STOP = frozenset("""
that this with from were have been being which their there these those than then
into over under when what where while also such more most some only other both
each very can could would should will shall about after before between during
within without through against among across per via using used use based
""".split())


def stems(text: str) -> set[str]:
    """4-letter stems of content words ('stable'/'stability' -> 'stab')."""
    return {t[:4] for t in tokens(normalize(text))
            if len(t) >= 4 and t not in _STOP and not t[0].isdigit()}


def support(claim_text: str, evidence: str) -> float:
    """Share of the claim's content-word stems that occur in the cited text.
    A crude check that a real quote is not being used for an unrelated claim."""
    cs = stems(claim_text)
    return 1.0 if not cs else len(cs & stems(evidence)) / len(cs)


# ---- sentence context and semantic guards ---------------------------------------------------------

_NUMWORDS = frozenset([*_ONES, *_TENS, "hundred", "thousand", "million", "billion"])
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])")


def sentences(text: str) -> list[str]:
    return [s for s in _SENT.split(normalize(text)) if s.strip()]


def context_of(quote_segments: list[str], chunk_texts: list[str]) -> str:
    """The sentence(s) of the cited chunks that contain the quote. A quote is often a fragment;
    the claim is judged against its whole sentence, not just the fragment."""
    keep: list[str] = []
    for seg in quote_segments:
        qt = set(tokens(normalize(seg).lower()))
        if not qt:
            continue
        best, best_f = None, 0.0
        for ct in chunk_texts:
            for s in sentences(ct):
                f = len(qt & set(tokens(s.lower()))) / len(qt)
                if f > best_f:
                    best, best_f = s, f
        if best is not None and best_f >= 0.6 and best not in keep:
            keep.append(best)
    return " ".join(keep)


def content_stems(text: str) -> set[str]:
    return {s for s in stems(text) if not any(w.startswith(s) for w in _NUMWORDS if len(w) >= 4 and w[:4] == s)}


_NEG = re.compile(r"\b(?:not|no|never|cannot|without|neither|nor|none)\b|n['’]t\b", re.I)
_HARD_NEG = re.compile(r"\b(?:not|never|cannot)\b|n['’]t\b", re.I)
# Opposite pairs: a claim using one side while the source uses only the other has reversed the finding.
_ANTONYMS = (("increas", "decreas"), ("increas", "reduc"), ("rise", "fall"), ("rose", "fell"), ("elevat", "reduc"),
             ("above", "below"), ("higher", "lower"), ("greater", "less"), ("greater", "fewer"), ("more", "less"),
             ("more", "fewer"), ("faster", "slower"), ("longer", "shorter"), ("improv", "worsen"), ("improv", "declin"),
             ("exceed", "below"), ("gain", "loss"), ("increas", "declin"), ("up", "down"))
_QUANT = frozenset({"all", "every", "always", "never", "only", "completely", "entirely", "universally",
                    "guaranteed", "any", "each", "whole"})
_UNIT_STOP = frozenset("of and to at in for with the a an was were is are or than by on from that as versus vs per "
                       "after before during within over under between among into onto upon about around approximately "
                       "mean median total".split())
_PAIR = re.compile(r"(?<![\w.,])(\d+(?:[.,]\d+)*)\s*(°\s*[CFKcfk]\b|%|[A-Za-zµμ]+(?:/[A-Za-zµμ]+)?)")
_TEMP = {"c": "c", "celsius": "c", "degc": "c", "f": "f", "fahrenheit": "f", "k": "k", "kelvin": "k"}


def _digitize(text: str) -> str:
    low = normalize(text).lower()
    low = _COMPOUND.sub(lambda m: str(_TENS[m.group(1)] + _ONES[m.group(2)]), low)
    return _SINGLE.sub(lambda m: str(_ONES.get(m.group(1), _TENS.get(m.group(1)))), low)


def _unit(u: str) -> str | None:
    u = u.lower().replace("°", "").replace(" ", "")
    if u in _UNIT_STOP or not u:
        return None
    u = _TEMP.get(u, u)
    return u[:-1] if len(u) > 3 and u.endswith("s") else u


def number_units(text: str) -> set[tuple[str, str]]:
    """{(number, unit)} for numbers directly followed by a unit; spelled numbers are digitised."""
    out = set()
    for m in _PAIR.finditer(_digitize(text)):
        u = _unit(m.group(2))
        if u:
            out.add((canon_num(m.group(1)), u))
    return out


def semantic_problem(claim: str, quote: str, context: str, chunk_text: str) -> str | None:
    """Cheap, deterministic checks for the ways a TRUE quote is most often turned into a false claim.
    Returns a purge reason or None. Intentionally conservative: when in doubt, purge."""
    ev = f"{quote} {context}"
    # 1. negation: a claim that negates something the source does not, or drops the source's negation
    if (_NEG.search(claim) and not _NEG.search(ev)) or (_HARD_NEG.search(quote) and not _NEG.search(claim)):
        return "negation_mismatch"
    # 2. direction: increase/decrease, above/below ... reversed relative to the source
    cw, ew = set(tokens(claim.lower())), set(tokens(ev.lower()))
    for x, y in _ANTONYMS:
        for a_, b_ in ((x, y), (y, x)):
            claim_a = any(t.startswith(a_) for t in cw)
            ev_a = any(t.startswith(a_) for t in ew)
            ev_b = any(t.startswith(b_) for t in ew)
            if claim_a and not ev_a and ev_b:
                return "direction_mismatch"
    # 3. units: every number the claim attaches a unit to must carry that unit in the source
    src = number_units(chunk_text)
    for n, u in sorted(number_units(claim)):
        if (n, u) not in src:
            return f"unit_mismatch:{n} {u}"
    # 4. absolute words the source does not use
    q = {t for t in tokens(claim.lower()) if t in _QUANT} - set(tokens(ev.lower()))
    if q:
        return f"unsupported_quantifier:{sorted(q)[0]}"
    return None
