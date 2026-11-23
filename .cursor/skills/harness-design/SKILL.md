---
name: harness-design
description: Design, build, and audit AI agent harnesses, tool interfaces (ACI), context builders, KV cache optimization, security threat models, permissions/sandboxes, and durable state logs. Use when developing AI assistants, agent loops, tool calling pipelines, MCP integrations, prompt/context engineering, or agentic workflows in ACCSYS or other projects.
---

# Harness Design — Designing the Layer Outside the Model

Core philosophy: **`Agent = Model + Harness`**.
The LLM is a stateless advisor that only *proposes* the next step (text or structured tool call). The **Harness** is the deterministic software layer around the model that builds context, enforces policy, executes tools inside a sandbox, repairs history, controls token economics, and persists state.

## Canonical Control Loop

```python
while not done:
    ctx    = build_context(history)      # Deterministic projection, prefix-cache friendly
    action = model(ctx)                  # Stateless API call with pre-flight budget check
    ok     = policy(action)              # deny > ask > allow before execution
    result = execute(action)             # ACI tools / parallel read-only / OS sandbox
    history.append(action, ok, result)   # Append-only WAL event log + atomic checkpoint
```

---

## 1. Stateless Agent Loop & History Integrity (M1, M4)

1. **Preserve Raw Model Replies Verbatim**:
   - Never decompose and reconstruct the model's response parts when appending to history. Opaque fields (e.g., Gemini `thoughtSignature`) must remain intact or subsequent turns will fail with HTTP 400.
2. **Strict Tool Call / Response Pairing**:
   - If a model turn contains $N$ tool calls, the immediately following turn **must** contain all $N$ corresponding `functionResponse` parts in the exact same order.
   - Never insert user messages or hook outputs between a `functionCall` and its `functionResponse`.
3. **Interrupt & Crash History Repair (`AbortController`)**:
   - On `Ctrl+C` or timeout: discard incomplete streaming assistant text; kill running child process groups; for an in-flight batch of $N$ tool calls, synthesize responses for every unfinished call (`"Interrupted by user"` or `"Skipped due to abort"`) so the conversation remains valid for the next turn.
4. **Retry & Idempotency Rules**:
   - Retry transient HTTP errors (`408`, `429` rate-limit, `500`, `503`) with truncated exponential backoff + jitter. Do **not** retry `400`, `401`, `403`, `404`, daily quota exhaustion, or user aborts (`signal.aborted`).
   - Only model calls and **read-only tools** may be auto-retried. Mutating tools must never be blindly retried.
5. **Parallel Execution**:
   - Read-only tools (`read_file`, `glob`, `grep`, read-only `task`) can run concurrently.
   - Workspace-mutating or external-side-effect tools must serialize, and results must be written back in the original call order.

---

## 2. Loop Economics & Prefix Caching (M2)

1. **Quadratic Input Cost Growth**:
   - With base context $B$ and per-turn growth $\Delta$, turn $k$ costs $I_k = B + (k-1)\Delta$, and cumulative input over $n$ turns is $S_n = nB + \Delta \frac{n(n-1)}{2}$.
   - Coding agents are prefill-dominated (`input : output` is often `98:1` to `174:1`; Input accounts for >90% of cost). Large outputs early in a session are re-billed on every subsequent turn.
2. **Protect the KV Cache Prefix**:
   - KV Cache only matches from token 1 up to the first differing token.
   - **Never** put dynamic timestamps, random IDs, or changing working directory paths at the top of the System Prompt.
   - Keep tool definitions and JSON schema key ordering strictly deterministic across turns.
   - **Never mutate or delete middle history turns** to save a few tokens—breaking the cached prefix forces a 10x full-price prefill for everything after the edit (takes 50+ turns to break even).

---

## 3. Agent–Computer Interface (ACI) & Tool Engineering (M3)

1. **Dedicated Tools Over Raw `bash`**:
   - Provide structured tools (`read_file`, `write_file`, `edit_file`, `glob`, `grep`) so the harness can classify side effects (**Read-Only** vs **Workspace-Write** vs **External-Impact**) and render clear diffs.
2. **String-Replace Uniqueness (`edit_file`)**:
   - Require `old_string` to match **exactly once** (unless `replace_all` is explicit). Avoid `String.prototype.replace` special replacement patterns (`$&`, `$$`), handle CRLF/LF transparently, and report line numbers.
3. **Errors & Truncation Are Prompts**:
   - Every tool error must state: *(1) what happened & whether state changed, (2) why, (3) current state, (4) concrete next step*.
   - When truncating output, always compute and tell the model the total line count and exact `offset` for the next page.
4. **Hooks vs Prompt Instructions**:
   - *"A prompt is a suggestion; a Hook is a guarantee."*
   - Feedback hooks (lint/typecheck after edit) run **Fail-Open** and append output to the current tool result. Security hooks run **Fail-Closed**.

---

## 4. Context Engineering & Long-Horizon Memory (M5, M6)

1. **Separate Event Log from Context View**:
   - `buildContext(log)` must be a pure, deterministic projection.
2. **Cache-Friendly Ordering (Most Stable → Most Dynamic)**:
   1. System Prompt + Global Rules
   2. Tool Definitions (fixed order)
   3. First History Turn: Project `AGENTS.md` + initial environment snapshot (set `GIT_CEILING_DIRECTORIES` to prevent leaking parent repos)
   4. Append-only conversation & tool history (append dynamic status like Todo list or git status to the *end* of the latest tool result)
3. **Large Outputs → File + Pointer**:
   - When tool output exceeds threshold, write full output to a scratch file (excluded from git/grep) and keep only summary stats + head 20% + tail 80% + file path in context.
4. **Keep Failures in Context, Verify Conclusions in Notes**:
   - Keep failed tool calls and error messages in history so the model does not repeat them (*Manus principle*).
   - External memory/notes should only record **tool-verified facts**, deleting outdated claims when disproven (*prevents Context Poisoning & Clash*).
5. **Compaction & Sub-agents (`task`)**:
   - Trigger compaction at ~70% context budget. Split **only between turns** (never split `functionCall` / `functionResponse`). Keep original user goal verbatim + latest 30% turns, summarizing the middle into `<state_snapshot>` using the same System Prompt prefix.
   - Delegate to read-only **Sub-agents** (`task`) when exploration input $D$ is large and answer $A$ is small: token savings $\approx (k-1)C - kb + R(D - A)$. Keep the main agent as the **single writer**.

---

## 5. Security Threat Model, Policy & Sandbox (M7, M8)

1. **Break the Lethal Trifecta**:
   - An agent with *(1) Private Data/Credentials + (2) Untrusted Content + (3) External Network* will leak secrets under Indirect Prompt Injection.
   - **Default-deny network** inside tool execution and **keep credentials out of the sandbox environment** (use an external proxy that injects auth headers or delegates via Service Account).
2. **Two-Layer Defense: Policy ≠ Sandbox**:
   - **Policy Engine** (`deny > ask > allow`) inspects intent before execution to reduce approval fatigue. Project-level config in a repo is untrusted and may only tighten (`deny`), never loosen (`allow`).
   - **OS Sandbox** (Seatbelt / bubblewrap / gVisor / Firecracker) mediates every kernel syscall during execution.
3. **Never Trust Static Command Parsing Alone**:
   - Even `git status` can execute arbitrary code if an agent first edits `.git/config` (`core.fsmonitor`).
   - **Dangling Symlink Rule**: File tools (`write_file`/`edit_file`) and `bash` must share the same sandbox view or strictly refuse following symlinks outside the workspace.

---

## 6. Durable State, Evals & Cloud Scale (M9–M12)

- **Append-Only WAL & Atomic Checkpoints**: Log `intent` before execution and `result` after; pair `(log_offset, workspace_commit)` so `/rewind` restores both conversation and files atomically.
- **Harness Testing vs Evals**: Test harness mechanics (permissions, compaction, abort repair) with a deterministic `MockModel`; evaluate end-to-end capability with isolated grading environments where tests and network are unreachable by the agent.
- **Scale Principle**: *"Execution is ephemeral; State is durable."* Manage Prefix Cache hit rate as a first-class production SLO; roll out prompt/schema changes canary-style to avoid global cache stampedes.

## Additional Resources

- For detailed mathematical formulas, lecture-by-lecture notes (M1–M12), and the 10 empirical findings from `rein`, see [reference.md](reference.md).
