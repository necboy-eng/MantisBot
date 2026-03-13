# Model Fallback & Frontend Error Notification Design

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Backend fallback logic + Frontend warning notifications

---

## Problem

When the agent calls a model API and encounters a service-unavailable error (quota exhausted, 429, 5xx, timeout), the frontend shows no feedback — the user sees a silent failure or a raw error message with no context and no recovery.

---

## Goals

1. Detect service-unavailable errors from model API calls
2. Automatically switch to the next available model and retry
3. Notify the user via the SSE stream that a switch occurred
4. Display a visible, styled warning Toast in the frontend

---

## Out of Scope

- Auth failures (401/403): config error, switching models won't help
- Model not found (404): config error, same reason
- Retrying the same model: not implemented in this iteration
- Per-model health tracking / circuit breaker: future work

---

## Architecture

### Fallback-Eligible Error Patterns

A new module `src/agents/model-error-detector.ts` encapsulates the detection logic.

**Triggers automatic model switch:**
- HTTP 429 / "rate limit" / "too many requests" / "quota"
- HTTP 500 / 502 / 503 / 504
- "service unavailable" / "overloaded" / "capacity"
- "gateway timeout" / "connection timeout" / network timeout

**Does NOT trigger switch:**
- HTTP 401 / 403 / "unauthorized" / "forbidden" / "invalid api key"
- HTTP 404 / "model not found"
- User input errors / validation errors

### Backend Fallback Flow (`http-server.ts`)

The existing `streamRun` call is wrapped with fallback logic:

```
[User message]
    ↓
streamRun(modelA)  ← throws 503
    ↓ catch
isFallbackableError(error) → true
    ↓
Find next enabled model from config.models (skip modelA)
    ↓
Send SSE: event: system
         data: { subtype: "model_fallback", content: "⚠️ ...", from: "modelA", to: "modelB" }
    ↓
Create new UnifiedAgentRunner with modelB
    ↓
streamRun(modelB)  ← resumes streaming
```

**Model selection order:** Sequential through `config.models` where `enabled !== false`, skipping already-tried models. If all models are exhausted, send a final `error` SSE event with a user-friendly message.

**Maximum attempts:** One pass through all available models (no infinite loops).

### SSE Protocol Change

The existing `system` event gains an optional `subtype` field:

```
event: system
data: { "subtype": "model_fallback", "content": "⚠️ modelA 不可用，已自动切换至 modelB", "from": "modelA", "to": "modelB" }
```

The existing vision-switch `system` event remains unchanged (no `subtype`, or `subtype: "vision_switch"`). Frontend distinguishes by presence of `subtype === "model_fallback"`.

### Frontend Changes

#### `Toast.tsx`
Extend `ToastItem` with an optional `type` field:
- `type: 'memory'` (existing, purple/indigo style)
- `type: 'warning'` (new, amber/orange style)

`ToastContainer` and `MemoryToast` are refactored to render style based on `type`.

Warning toast shows:
- Icon: ⚠️
- Header: "模型已自动切换"
- Body: "X 不可用，已切换至 Y"
- Duration: 5000ms (longer than memory toast's 3000ms, more important)

#### `App.tsx`
In the SSE event loop, handle `system` events with `subtype === "model_fallback"`:
1. Render an inline system notice in the message stream (light gray, same as vision switch)
2. Also fire a warning Toast via `setToasts`

---

## Files Changed

| File | Change |
|---|---|
| `src/agents/model-error-detector.ts` | **New**: `isFallbackableError(error: unknown): boolean` |
| `src/channels/http-ws/http-server.ts` | **Modify**: wrap `streamRun` with fallback loop |
| `web-ui/src/components/Toast.tsx` | **Modify**: add `type` field, render warning style |
| `web-ui/src/App.tsx` | **Modify**: handle `model_fallback` system event |

---

## Error Detection Logic

```typescript
// src/agents/model-error-detector.ts
export function isFallbackableError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  // Rate limit / quota
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota')) return true;
  // Server errors
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
  // Service state
  if (msg.includes('service unavailable') || msg.includes('overloaded') || msg.includes('capacity')) return true;
  // Timeouts / network
  if (msg.includes('timeout') || msg.includes('gateway')) return true;
  return false;
}
```

---

## User Experience

**Before:** Model fails silently or shows raw error text in the chat bubble.

**After:**
1. Chat continues with the next model, no interruption to previous streamed content
2. An inline notice appears in the stream: `⚠️ modelA 不可用，已自动切换至 modelB`
3. An amber Toast notification appears bottom-right: "模型已自动切换 — X 不可用，已切换至 Y" (visible 5s)
4. If all models fail: a clear error message explains no models are available

---

## Testing Notes

- Simulate 429 by temporarily setting an invalid API key with a quota-exhausted response body
- Verify the `system` SSE event fires before the fallback `streamRun` begins
- Verify the Toast appears and auto-dismisses after 5s
- Verify that auth errors (401) do NOT trigger fallback
