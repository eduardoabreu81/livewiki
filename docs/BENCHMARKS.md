# Benchmarks

> **Historical measurement — not a claim about the current release.**
>
> - Measurement date: **2026-07-27**
> - Measured livewiki commit: **`f2601ff`**
> - Distance recorded on 2026-08-13: **68 commits** after the measured revision
> - Validity: these figures describe `f2601ff` only; they do not describe the current version of livewiki

## OpenWiki comparison

Blind A/B on the same real-world repository (a MoneyPrinterTurbo-Plus
clone): two independent evaluators (claude and codex) scored masked
corpora — ours and a frozen OpenWiki control — without knowing which was
which. Final round of a 5-round measurement series:

| | livewiki | OpenWiki |
| --- | --- | --- |
| Weighted quality — evaluator A | 7.65 | 8.05 |
| Weighted quality — evaluator B | 7.85 | 8.30 |
| Coverage — both evaluators | **9/9** | lower on both cards |
| Unresolvable links in corpus | **0** (564/564 resolve) | — |
| Tokens for a full-repo run | **1,078,557** | 13,900,000 |

Reading this historical run honestly: quality was a near-tie (Δ0.40–0.45
behind on weighted scores), and coverage was the one dimension where both
evaluators scored livewiki ahead — at approximately 8% of the token cost.
Evaluator A described the two corpora as "close to complementary".

The data has been retained as historical evidence. No current-release result
is inferred from it; a new comparison requires a separate measurement run.
