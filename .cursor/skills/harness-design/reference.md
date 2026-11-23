# Harness Design — Complete Reference & Empirical Notes (M1–M12)

Source: [Harness Design Course (`rein`)](https://harness-design-dn4zb55ecq-de.a.run.app/)

---

## 1. Mathematical & Economic Formulas

### Cumulative Input Token Formula (Lecture 2)
Let $B$ be the fixed prefix (System Prompt + Tool Schemas + `AGENTS.md`) and $\Delta$ be the average tokens added per turn.
- Turn $k$ input tokens:
  $$I_k = B + (k - 1)\Delta$$
- Cumulative input tokens across $n$ turns:
  $$S_n = \sum_{k=1}^n I_k = nB + \Delta \frac{n(n - 1)}{2}$$
- **Implication**: A 10,000-token log ingested at turn 2 of a 20-turn session is billed 18 times (180,000 input tokens). Truncate or offload to a file pointer immediately.

### Reliability Metrics: $\text{pass}@k$ vs $\text{pass}^k$ (Lecture 2 & 7)
Given single-trial success probability $p$:
- **At least one success in $k$ tries** (useful when a verifier/test suite exists, or from an attacker's perspective):
  $$\text{pass}@k = 1 - (1 - p)^k$$
- **All $k$ tries succeed** (required for unattended automation / production reliability / defender's perspective):
  $$\text{pass}^k = p^k$$
  *(Example: $p = 0.8 \implies \text{pass}^5 = 0.328$; an attacker with $p = 0.1$ injection success achieves $65\%$ success in 10 attempts).*

### Sub-Agent (`task`) Token Accounting (Lecture 6)
Let main agent current context be $C$, remaining turns in main session be $R$, sub-agent turns be $k$, raw data read by sub-agent be $D$, final summary returned to main agent be $A$, and sub-agent fixed prompt overhead be $b$:
$$\text{Token Savings} \approx (k - 1)C - kb + R(D - A)$$
- Sub-agents save tokens **only** when the task is bounded, reads large intermediate data ($D \gg A$), and happens when main context $C$ or remaining turns $R$ are substantial.

### Warm Pool Sizing via Little's Law (Lecture 11)
$$L = \lambda \times W$$
At $\lambda = 104\text{ sandboxes/sec}$ and cold-start $W = 60\text{ s}$, a minimum warm pool of $6,250$ pre-warmed microVMs is required to avoid queueing delays.

---

## 2. Ten Empirical Findings from `rein` Implementation Notes

1. **Final Assistant Event Ordering (M1)**:
   - Always emit the final `assistant` turn event and usage metrics *before* closing the loop, or CLI/headless consumers will miss the final answer.
2. **Missing Tool Responses Can Cause Silent Hallucinations (M1)**:
   - Returning 1 response for 2 tool calls triggers HTTP 400. However, returning *zero* tool responses and appending a `user` text message can return HTTP 200 on Gemini Flash while causing the model to hallucinate that the command succeeded.
3. **Implicit Cache Minimum Threshold (M2)**:
   - Gemini Flash implicit caching requires at least **6,144 tokens**; below that threshold, `cachedContentTokenCount` is always `0`.
4. **Step-Function Cache Quantization (M2)**:
   - Prefix cache is allocated in ~**4,096-token blocks**, causing sawtooth hit-rate curves that jump every ~4K tokens.
5. **Cross-Session Prefix Sharing (M2)**:
   - Within the same GCP project, if Session B shares the exact same initial prefix as Session A, Turn 1 immediately hits the cache (~42% hit rate).
6. **Timestamp-at-Top Catastrophe (M2)**:
   - Placing a per-turn timestamp at the start of the System Prompt dropped 40-turn cache hit rate from **67.8% to 0%**, increasing total cost by **2.4x–2.5x**.
7. **Input-Dominated Billing (M2)**:
   - Over 20 turns, `input : (output + thoughts)` reaches **174 : 1**, with Input tokens representing **93.3%–97.3%** of total cost.
8. **Missing `git init` Boundary Leak (M3)**:
   - Running an eval in a temp folder without `git init` caused `git status`/`git diff` to walk up into the parent `rein` repository, leaking harness source code and increasing token usage by **61%**. Always set `GIT_CEILING_DIRECTORIES`.
9. **Eval Prompt Bias (M3)**:
   - Eval prompts that explicitly name the target file and tool fail to test whether tool descriptions are discoverable in realistic scenarios.
10. **Lossy `read_file` Pushes Model Back to `bash` (M3)**:
    - Normalizing CRLF to LF or hiding tab characters in `read_file` forced the model to fall back to `bash` (`file`, `node -e`) when debugging line endings. Report line-ending metadata explicitly.

---

## 3. Milestone Checklist for ACCSYS Agentic Features

| Milestone | Component | Verification Checklist |
| :--- | :--- | :--- |
| **M1–M2** | Model Client & Cost | Raw response parts preserved; prefix static; token usage & cache hits logged per turn. |
| **M3** | ACI Tools | Side-effects categorized; `edit_file` checks uniqueness; errors include recovery hints; outputs paginated. |
| **M4** | Loop Control | Pre-call budget guard; repeat-action hash detector; `AbortController` repairs unfinished tool calls. |
| **M5–M6** | Context & Compaction | Pure `buildContext()`; >threshold outputs saved to file pointers; compaction splits only between turns at 70% budget. |
| **M7–M8** | Security & Policy | `deny > ask > allow`; credentials isolated outside tool env; strict recipient/network allowlists in test & prod. |
| **M9–M10** | Durability & Evals | Append-only audit/event log; idempotency keys on mutating actions; deterministic unit tests + isolated evals. |
