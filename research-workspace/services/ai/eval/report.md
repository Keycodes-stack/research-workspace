# Evaluation report (offline (pipeline only; models are scripted))

Embedder `hash`, gate 0.0, top_k 4, 27 questions.

- retrieval_recall_at_k: **1.0**
- mrr: **0.967**
- answer_accuracy: **0.737**
- refusal_accuracy: **0.714**
- conflict_detection: **None**
- forbidden_strings_shown: **0**

## Adversarial injection (bad claims that reached the user)

- fabricate: 0 bad shown (0 answers shown of 19 questions)
- number: 0 bad shown (0 answers shown of 19 questions)
- negate: 0 bad shown (10 answers shown of 19 questions)
- wrongchunk: 0 bad shown (0 answers shown of 19 questions)

## Gate sweep

| gate | answerable passing | unanswerable passing |
|---|---|---|
| 0.0 | 1.0 | 1.0 |
| 0.3 | 0.833 | 0.571 |
| 0.4 | 0.611 | 0.0 |
| 0.5 | 0.389 | 0.0 |
| 0.6 | 0.111 | 0.0 |
| 0.7 | 0.0 | 0.0 |
| 0.76 | 0.0 | 0.0 |
| 0.8 | 0.0 | 0.0 |
| 0.85 | 0.0 | 0.0 |

> The hash embedder has no semantics: retrieval and gate numbers above are NOT evidence for the 0.76 threshold. Re-run with `--embedder bge`.

> Offline limits seen: the scripted analyst answers off-topic questions with a real but irrelevant sentence (Q14, Q16) and the verifier cannot catch that, because the quote is genuine and supports the claim. Question relevance is the job of the similarity gate and the live models; conflict detection needs live models.

> Offline run: models are scripted. These numbers test the pipeline, not model quality.

## Per question

| id | kind | result | reason | correct | leaked |
|---|---|---|---|---|---|
| Q01 | answerable | consensus | models_agree | True |  |
| Q02 | answerable | consensus | models_agree | True |  |
| Q03 | answerable | consensus | models_agree | False |  |
| Q04 | answerable | consensus | models_agree | True |  |
| Q05 | answerable | insufficient_evidence | both_models_insufficient | False |  |
| Q06 | answerable | consensus | models_agree | True |  |
| Q07 | answerable | consensus | models_agree | True |  |
| Q08 | answerable | consensus | models_agree | True |  |
| Q09 | answerable | consensus | models_agree | True |  |
| Q10 | answerable | consensus | models_agree | True |  |
| Q11 | conditional | consensus | models_agree | False |  |
| Q12 | conditional | consensus | models_agree | True |  |
| Q13 | conditional | consensus | models_agree | True |  |
| Q14 | unanswerable | consensus | models_agree | True |  |
| Q15 | unanswerable | insufficient_evidence | both_models_insufficient | True |  |
| Q16 | unanswerable | consensus | models_agree | True |  |
| Q17 | unanswerable | insufficient_evidence | both_models_insufficient | True |  |
| Q18 | unanswerable | insufficient_evidence | both_models_insufficient | True |  |
| Q19 | conflict | consensus | models_agree | True |  |
| Q20 | injection | insufficient_evidence | both_models_insufficient | True |  |
| Q21 | injection | consensus | models_agree | True |  |
| Q22 | numeric_trap | consensus | models_agree | True |  |
| Q23 | numeric_trap | insufficient_evidence | both_models_insufficient | False |  |
| Q24 | numeric_trap | consensus | models_agree | True |  |
| Q25 | answerable | insufficient_evidence | both_models_insufficient | False |  |
| Q26 | answerable | consensus | models_agree | True |  |
| Q27 | unanswerable | insufficient_evidence | both_models_insufficient | True |  |