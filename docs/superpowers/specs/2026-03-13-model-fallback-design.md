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

**Model selection order:** Sequential through `config.models` where `enabled !== false`, skipping already-tried models. If all models are exhausted, send a final `error` SSE event:

```
event: error
data: { "content": "⚠️ 所有可用模型均无法响应，请稍后重试或检查模型配置。" }
```

**Maximum attempts:** One pass through all available models (no infinite loops).

**Runner cache update:** After a successful fallback, the new runner MUST replace the old one in `activeAgentRunners` so subsequent requests in the same session use the working model:

```typescript
activeAgentRunners.set(session.id, fallbackRunner);
```

**Content continuity:** If the original model emitted partial `chunk` content before throwing, the error interrupts that stream. The fallback model starts a fresh response from scratch (`fullContent` resets to empty). The `system` model_fallback notice is appended after any partial content already sent, so the user sees: `[partial text if any] ⚠️ modelA 不可用，已切换至 modelB [fresh response from modelB]`.

### SSE Protocol Change

The existing `system` event gains an optional `subtype` field:

```
event: system
data: { "subtype": "model_fallback", "content": "⚠️ modelA 不可用，已自动切换至 modelB", "from": "modelA", "to": "modelB" }
```

The existing vision-switch `system` event remains unchanged (no `subtype`, or `subtype: "vision_switch"`). Frontend distinguishes by presence of `subtype === "model_fallback"`.

### Frontend Changes

#### `App.tsx`
**Note:** The frontend currently has NO handler for `system` events — this is a new addition, not a modification of existing code.

In the SSE event loop, add a new `system` event handler after the `permission` handler:

```typescript
// 处理 system 事件（视觉切换、模型 fallback 通知）
if (currentEvent === 'system') {
  if (parsed.subtype === 'model_fallback') {
    // 1. Inline notice appended to current bubble
    setStreamMessages(prev => prev.map(msg =>
      msg.id === currentAssistantMsgId
        ? { ...msg, content: msg.content + `\n\n${parsed.content}` }
        : msg
    ));
    // 2. Warning Toast (amber, 5s)
    setToasts(prev => [...prev, {
      id: generateUUID(),
      content: parsed.content,
      type: 'warning',
    }]);
  } else {
    // Other system notices (e.g., vision switch — no subtype)
    setStreamMessages(prev => prev.map(msg =>
      msg.id === currentAssistantMsgId
        ? { ...msg, content: msg.content + `\n\n${parsed.content}` }
        : msg
    ));
  }
}
```

#### `Toast.tsx` (web-ui/src/components/Toast.tsx)

Extend `ToastItem` with an optional `type` field:

- `type: 'memory'` (existing default, purple/indigo style, 3000ms)
- `type: 'warning'` (new, amber/orange style, 5000ms)

`MemoryToast` reads `toast.type` to select style and duration:

```typescript
const duration = toast.type === 'warning' ? 5000 : 3000;
const timer = setTimeout(() => onDismiss(toast.id), duration);
```

Warning toast display:

- Icon: ⚠️
- Header: "模型已自动切换"
- Body: "X 不可用，已切换至 Y"
- Duration: 5000ms

---

## Error Detection Logic

Prefer structured HTTP status code fields over string matching to avoid false positives (e.g., "500 dollars", "capacity planning").

```typescript
// src/agents/model-error-detector.ts
export function isFallbackableError(error: unknown): boolean {
  // Prefer structured status code (more reliable, avoids false positives)
  const status = (error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.response?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;

  // Fallback: string matching for network-level errors without a status code
  const msg = String(error).toLowerCase();
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded')) return true;
  if (msg.includes('service unavailable') || msg.includes('overloaded') || msg.includes('over capacity')) return true;
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('gateway')) return true;
  return false;
}
```

**Note:** Bare numeric strings like `'500'` are intentionally excluded from string matching to avoid matching user message content. Status code detection is via structured `.status` / `.statusCode` / `.response.status` fields on the error object.

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

- Simulate 429 by temporarily pointing a model at an endpoint that returns `{ "error": "quota exceeded" }` with status 429
- Verify the `system` SSE event fires before the fallback `streamRun` begins
- Verify the Toast appears (amber) and auto-dismisses after 5s
- Verify that auth errors (401) do NOT trigger fallback
- Verify subsequent requests in the same session use the fallback model (runner cache updated)
- Verify bare numeric strings in user messages (e.g., "error 500") do NOT trigger fallback
