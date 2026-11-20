# Ask flow: from question to verified answer

These diagrams use Mermaid; GitHub and VS Code (with a Mermaid preview) draw them as graphics.
Code references: `services/ai/app/routes_tasks.py` (`ask`, `plan_evidence`, `search_and_store`), `apps/web/public/halden-bridge.js` (`runAsk`, `watchProgress`).

---

## 1. The whole system

```mermaid
flowchart LR
    U([User]) --> P["Halden page<br/>halden.html"]
    P --> B["Bridge<br/>halden-bridge.js"]
    B -->|"POST /threads/id/ask"| R["Render web app<br/>Next.js proxy /api/backend"]
    B -.->|"GET /threads/id/progress<br/>every 1 s"| R
    R --> G["Gateway (Go)<br/>auth + forwarding"]
    G --> AI["AI service (FastAPI)<br/>on the VPS"]
    AI --> DB[("Postgres + pgvector<br/>sources, chunks, messages, citations")]
    AI --> API["OpenAlex + Europe PMC"]
    AI --> PDF["Open-access PDFs"]
    AI --> S3[("PDF storage")]
    AI --> LLM["Model A + Model B<br/>(Groq / Mistral / Gemini)"]
```

---

## 2. Which sources answer the question (`plan_evidence`)

```mermaid
flowchart TD
    Q([Question arrives]) --> S{"Sources setting?"}

    S -->|My uploads| UP["Search every upload in the project<br/>(from any chat, incl. new attachments)"]
    UP --> NEVER["Never searches online"]

    S -->|Online| OF{"First question<br/>in this chat?"}
    OF -->|yes| FRESH1["Fresh online search<br/>answer from its top 10 papers only"]
    OF -->|no| HASP{"Project has<br/>stored papers?"}
    HASP -->|no| FRESH1
    HASP -->|yes| SAVEDP["Search the project's stored papers<br/>(uploads not used)"]
    SAVEDP --> COV1{"Best match<br/>≥ 0.65?"}
    COV1 -->|yes| ANS1{"Models find a verified<br/>answer in them?"}
    ANS1 -->|yes| DONE1["Answer from stored papers<br/>(no search)"]
    ANS1 -->|no| TELL1
    COV1 -->|no| TELL1["Tell user: not in saved sources"] --> FRESH1

    S -->|Uploads + online| BF{"First question<br/>in this chat?"}
    BF -->|yes| BOTH["Search uploads AND run a fresh online search<br/>at the same time → one combined answer"]
    BF -->|no| HASS{"Anything saved?<br/>(uploads or papers)"}
    HASS -->|no| BOTH
    HASS -->|yes| SAVEDB["Search uploads + stored papers"]
    SAVEDB --> COV2{"Best match<br/>≥ 0.65?"}
    COV2 -->|yes| ANS2{"Models find a verified<br/>answer in them?"}
    ANS2 -->|yes| DONE2["Answer from saved sources<br/>(no search)"]
    ANS2 -->|no| TELL2
    COV2 -->|no| TELL2["Tell user: not in saved sources"] --> BOTH
```

---

## 3. "Not in saved sources" (the user is told first)

```mermaid
sequenceDiagram
    participant Page as Page (bridge)
    participant AI as AI service
    participant DB as Database
    participant Web as OpenAlex + Europe PMC

    Page->>AI: ask(question, scope)
    AI->>DB: search saved sources
    DB-->>AI: best match below 0.65
    AI-->>Page: kind = not_in_saved_sources (nothing stored)
    Note over Page: Shows "No relevant information in this<br/>project's N saved sources. Searching…"
    Page->>AI: ask(question, scope, evidence = online)
    AI->>Web: fresh search
    AI->>DB: store top 10 papers (full text + vectors)
    AI-->>Page: answer (question stored once)
```

---

## 4. Online search and storage (`search_and_store`)

```mermaid
flowchart TD
    A["Search text<br/>(question + topic of the chat if it says 'it', 'this'…)"] --> K["Keywords<br/>(filler words removed)"]
    K --> SRCH["OpenAlex (50) + Europe PMC (25)<br/>in parallel, ~12 s budget"]
    SRCH --> LONG{"Fewer than 25 results<br/>and a long question?"}
    LONG -->|yes| RETRY["Retry with the 6 most<br/>specific words"] --> MERGE
    LONG -->|no| MERGE["Merge, remove duplicates by DOI"]
    MERGE --> TOP["Top 10 in the APIs' own relevance order<br/>(skip papers with no PDF and no abstract)"]
    TOP --> KNOWN{"Already in<br/>the project?"}
    KNOWN -->|yes| REUSE["Reuse its stored chunks"]
    KNOWN -->|no| ING["Download open-access PDF"]
    ING --> OK{"PDF parsed?"}
    OK -->|yes| FULL["Full text"]
    OK -->|no| ABS["Abstract only"]
    FULL --> CH["Chunk (512 tokens) + embed (BGE)"]
    ABS --> CH
    CH --> STORE[("sources + chunks in Postgres<br/>kept forever, shown in Knowledge Library")]
    REUSE --> OUT["Source ids for this answer"]
    STORE --> OUT
```

---

## 5. From passages to a verified answer

```mermaid
flowchart TD
    V["Question → vector (BGE)"] --> RET["pgvector search: the 2 best passages<br/>of every paper in the chosen sources"]
    RET --> DIV["Reading order: every paper's best passage first,<br/>then second passages (the token budget cuts from the end)"]
    DIV --> SEAL{"Passage text still matches<br/>its sha256 seal?"}
    SEAL -->|no| DROP["Dropped"]
    SEAL -->|yes| GATE{"Best match ≥ 0.65?"}
    GATE -->|no| REF["Refuse without asking any model<br/>(reason shown to the user)"]
    GATE -->|yes| BUD["Fit the token budget"]
    BUD --> MA["Model A<br/>lead scientist"]
    BUD --> MB["Model B<br/>speed auditor"]
    MA --> X["Cross-check: which claims<br/>both models agree on"]
    MB --> X
    X --> VER["Verifier, per claim:<br/>exact quote · numbers · units · negation ·<br/>direction · subject from paper title"]
    VER -->|fails| PURGE["Claim removed"]
    VER -->|passes| KEEP["Verified claim with citation"]
    KEEP --> SAVE[("message + citations saved")]
    PURGE --> SAVE
    SAVE --> RESP["Answer + status steps + accuracy %"]
```

---

## 6. Live progress (what the user sees while waiting)

```mermaid
sequenceDiagram
    participant Page
    participant AI as AI service
    Page->>AI: POST ask
    loop every second until the answer arrives
        Page->>AI: GET progress
        AI-->>Page: steps so far
    end
    Note over Page: e.g. "Searching this project's 3 uploaded documents…"<br/>"Found 50 papers. Downloading the top 10…"<br/>"Stored 3 of 10: [paper title] (full text, 42 passages)"<br/>"Models A and B are reading 10 passages from 7 papers…"
    AI-->>Page: final answer
```

---

## Refusal reasons the user can see

| Reason | When |
|---|---|
| `no_uploads` | My uploads, but the project has no uploaded documents |
| `online_search_failed` | The online search returned no papers (APIs down, rate-limited or nothing found) |
| `below_similarity_threshold` | Passages exist but none is close enough (best match < 0.65); no model is asked |
| `insufficient_evidence` (from the models) | Both models say the passages don't answer it; their reason is shown |
| `integrity_failure` | A stored passage no longer matches its seal |
