# Model Fallback & Frontend Error Notification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect model API service-unavailable errors, automatically switch to the next available model, and notify the user via SSE stream and warning Toast.

**Architecture:** New `model-error-detector.ts` module detects fallback-eligible errors. Backend `http-server.ts` wraps `streamRun` with fallback loop. Frontend adds `system` event handler and warning Toast style.

**Tech Stack:** TypeScript, Vitest, React, SSE

---

## Chunk 1: Error Detection Module

### Task 1: Create Model Error Detector

**Files:**
- Create: `src/agents/__tests__/model-error-detector.test.ts`
- Create: `src/agents/model-error-detector.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/agents/__tests__/model-error-detector.test.ts
import { describe, test, expect } from 'vitest';
import { isFallbackableError } from '../model-error-detector.js';

describe('isFallbackableError', () => {
  describe('HTTP status code detection', () => {
    test('should return true for 429 status', () => {
      const error = { status: 429, message: 'Too Many Requests' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 500 status', () => {
      const error = { status: 500, message: 'Internal Server Error' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 502 status', () => {
      const error = { status: 502, message: 'Bad Gateway' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 503 status', () => {
      const error = { status: 503, message: 'Service Unavailable' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 504 status', () => {
      const error = { status: 504, message: 'Gateway Timeout' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return false for 401 status', () => {
      const error = { status: 401, message: 'Unauthorized' };
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for 403 status', () => {
      const error = { status: 403, message: 'Forbidden' };
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for 404 status', () => {
      const error = { status: 404, message: 'Not Found' };
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should check statusCode as alternative field', () => {
      const error = { statusCode: 429 };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should check response.status as nested field', () => {
      const error = { response: { status: 503 } };
      expect(isFallbackableError(error)).toBe(true);
    });
  });

  describe('String pattern detection', () => {
    test('should detect rate limit in message', () => {
      const error = new Error('rate limit exceeded');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect too many requests in message', () => {
      const error = new Error('too many requests');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect quota exceeded in message', () => {
      const error = new Error('quota exceeded for this month');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect service unavailable in message', () => {
      const error = new Error('service unavailable');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect overloaded in message', () => {
      const error = new Error('model is overloaded');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect over capacity in message', () => {
      const error = new Error('server is over capacity');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect timeout in message', () => {
      const error = new Error('connection timeout');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect econnrefused in message', () => {
      const error = new Error('ECONNREFUSED 127.0.0.1:8080');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect econnreset in message', () => {
      const error = new Error('ECONNRESET');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect gateway in message', () => {
      const error = new Error('bad gateway');
      expect(isFallbackableError(error)).toBe(true);
    });
  });

  describe('False positive prevention', () => {
    test('should NOT match bare 500 in user content', () => {
      const error = new Error('the budget is 500 dollars');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should NOT match capacity in normal context', () => {
      const error = new Error('capacity planning is important');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for generic errors', () => {
      const error = new Error('something went wrong');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for invalid api key', () => {
      const error = new Error('invalid api key');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for model not found', () => {
      const error = new Error('model not found');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for unauthorized', () => {
      const error = new Error('unauthorized access');
      expect(isFallbackableError(error)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('should return false for null', () => {
      expect(isFallbackableError(null)).toBe(false);
    });

    test('should return false for undefined', () => {
      expect(isFallbackableError(undefined)).toBe(false);
    });

    test('should return false for string input', () => {
      expect(isFallbackableError('error string')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run src/agents/__tests__/model-error-detector.test.ts`
Expected: FAIL with "cannot find module" or similar

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/agents/model-error-detector.ts
/**
 * Model Error Detector
 *
 * Determines whether an error from a model API call is eligible for
 * automatic fallback to another model.
 *
 * Fallback-eligible errors:
 * - HTTP 429 (rate limit / quota)
 * - HTTP 500/502/503/504 (server errors)
 * - Network timeouts and connection failures
 *
 * NOT eligible:
 * - HTTP 401/403 (auth errors)
 * - HTTP 404 (model not found)
 */

export function isFallbackableError(error: unknown): boolean {
  if (!error) return false;

  // Prefer structured status code (more reliable, avoids false positives)
  const status = (error as any)?.status ??
                 (error as any)?.statusCode ??
                 (error as any)?.response?.status;

  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  // Fallback: string matching for network-level errors without a status code
  // Note: Bare numeric strings like '500' are intentionally excluded to avoid
  // matching user message content (e.g., "error 500", "500 dollars")
  const msg = String(error).toLowerCase();

  // Rate limit / quota
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded')) {
    return true;
  }

  // Service state
  if (msg.includes('service unavailable') || msg.includes('overloaded') || msg.includes('over capacity')) {
    return true;
  }

  // Timeouts / network
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('gateway')) {
    return true;
  }

  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run src/agents/__tests__/model-error-detector.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/model-error-detector.ts src/agents/__tests__/model-error-detector.test.ts
git commit -m "feat(agents): add model error detector for fallback eligibility

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Backend Fallback Logic

### Task 2: Add Fallback Loop to HTTP Server

**Files:**
- Modify: `src/channels/http-ws/http-server.ts` (lines ~870-1020)

**Context:** The `streamRun` call is inside a `for await` loop around line 880. We need to wrap this in a fallback mechanism that:
1. Catches fallback-eligible errors
2. Finds the next available model
3. Sends a `system` SSE event
4. Retries with the new model

- [ ] **Step 1: Add import for error detector**

At the top of `http-server.ts` (around line 30), add:

```typescript
import { isFallbackableError } from '../../agents/model-error-detector.js';
```

- [ ] **Step 2: Create helper function to find next available model**

Add this helper function before the `createHTTPServer` function:

```typescript
/**
 * Find the next available model for fallback
 * Returns null if no other models are available
 */
function findNextModel(
  config: any,
  currentModel: string,
  triedModels: Set<string>
): { name: string; model: any } | null {
  const models = config.models as any[];
  for (const m of models) {
    if (m.enabled === false) continue;
    if (m.name === currentModel) continue;
    if (triedModels.has(m.name)) continue;
    return { name: m.name, model: m };
  }
  return null;
}
```

- [ ] **Step 3: Wrap streamRun in fallback loop**

Locate the `for await (const chunk of effectiveRunner.streamRun(...))` loop (around line 880). Replace the entire streaming block with a fallback-aware version.

Find this section (approximately lines 874-1018):

```typescript
      // Stream process
      if (visionSwitchNotice) {
        res.write(`event: system\ndata: ${JSON.stringify({ content: visionSwitchNotice })}\n\n`);
        (res as any).flush?.();
      }

      for await (const chunk of effectiveRunner.streamRun(contextualMessage, history)) {
        // ... existing chunk handling ...
      }

      res.end();
```

Replace with:

```typescript
      // Stream process with model fallback support
      if (visionSwitchNotice) {
        res.write(`event: system\ndata: ${JSON.stringify({ content: visionSwitchNotice })}\n\n`);
        (res as any).flush?.();
      }

      // Track tried models for fallback
      const triedModels = new Set<string>();
      triedModels.add(modelName);

      // Fallback loop - try each model once
      let currentRunner = effectiveRunner;
      let currentModelName = modelName;
      let fallbackCount = 0;

      fallbackLoop: while (true) {
        try {
          for await (const chunk of currentRunner.streamRun(contextualMessage, history)) {
            const chunkAny = chunk as any;

            // === Chunk type handlers (same as original) ===
            if (chunk.type === 'thinking' && chunk.content) {
              collectedThinking += chunk.content;
              console.log('[HTTPServer] Sending thinking event:', chunk.content.slice(0, 50));
              res.write(`event: thinking\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'text' && chunk.content) {
              fullContent += chunk.content;
              console.log('[HTTPServer] Sending chunk event:', chunk.content.slice(0, 50));
              res.write(`event: chunk\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'tool_use') {
              console.log('[HTTPServer] Tool start:', chunk.tool, chunk.args);
              collectedToolStatus.push({
                tool: chunk.tool ?? '',
                toolId: chunk.toolId,
                status: 'start',
                args: chunk.args,
                timestamp: Date.now(),
              });
              res.write(`event: tool\ndata: ${JSON.stringify({
                tool: chunk.tool,
                toolId: chunk.toolId,
                status: 'start',
                args: chunk.args
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'tool_result') {
              console.log('[HTTPServer] Tool end:', chunk.tool, 'Args:', chunk.args, 'Result type:', typeof chunk.result);
              const startIdx = collectedToolStatus.slice().reverse().findIndex(
                t => t.toolId === chunk.toolId && t.status === 'start'
              );
              if (startIdx >= 0) {
                const realIdx = collectedToolStatus.length - 1 - startIdx;
                const raw = chunk.result;
                const truncated = typeof raw === 'string' && raw.length > MAX_TOOL_RESULT_LEN
                  ? raw.slice(0, MAX_TOOL_RESULT_LEN) + '…'
                  : raw;
                collectedToolStatus[realIdx] = {
                  ...collectedToolStatus[realIdx],
                  status: 'end',
                  result: truncated,
                  isError: chunk.isError,
                };
              }
              res.write(`event: tool\ndata: ${JSON.stringify({
                tool: chunk.tool,
                toolId: chunk.toolId,
                status: 'end',
                args: chunk.args,
                result: chunk.result,
                isError: chunk.isError
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'permission') {
              const perm = chunkAny.permission;
              console.log('[HTTPServer] Permission request:', perm);
              res.write(`event: permission\ndata: ${JSON.stringify({
                requestId: perm.requestId,
                toolName: perm.toolName,
                toolInput: perm.toolInput,
                isDangerous: perm.isDangerous,
                reason: perm.reason,
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'agent_invocation') {
              console.log('[HTTPServer] Sending agent event:', { agentName: chunk.agentName, phase: chunk.phase, task: (chunk.content || '').slice(0, 100) });
              res.write(`event: agent\ndata: ${JSON.stringify({
                agentName: chunk.agentName,
                agentId: chunk.agentId,
                phase: chunk.phase,
                task: chunk.content,
              })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'error') {
              console.log('[HTTPServer] Error:', chunk.content);
              res.write(`event: error\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
              (res as any).flush?.();
            } else if (chunk.type === 'complete') {
              // Save message to session
              const assistantMessage = {
                id: uuidv4(),
                role: 'assistant' as const,
                content: fullContent,
                timestamp: Date.now(),
                attachments: chunk.attachments,
                ...(collectedToolStatus.length > 0 && { toolStatus: collectedToolStatus }),
                ...(collectedThinking && { thinking: collectedThinking.slice(0, MAX_THINKING_LEN) }),
              };
              session.messages.push(assistantMessage);

              const newClaudeSessionId = currentRunner.getSessionId?.();
              if (newClaudeSessionId && newClaudeSessionId !== session.claudeSessionId) {
                session.claudeSessionId = newClaudeSessionId;
                console.log('[HTTPServer] Saved claudeSessionId to session:', newClaudeSessionId);
              }

              options.sessionManager.updateSession(session);

              const doneData = {
                messageId: assistantMessage.id,
                attachments: chunk.attachments,
                sessionName: session.name,
                usage: chunk.usage,
              };
              console.log('[HTTPServer] Sending done event with attachments:', chunk.attachments?.length || 0);
              res.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);

              detectPreferencesAndPropose(session.messages).catch(err => {
                console.error('[HTTPServer] Failed to detect preferences (async):', err);
              });

              // Success - exit fallback loop
              break fallbackLoop;
            }
          }
          // If we reach here without error, streaming completed successfully
          break fallbackLoop;

        } catch (streamError: any) {
          console.error('[HTTPServer] Stream error:', streamError?.message || streamError);

          // Check if this error is eligible for fallback
          if (!isFallbackableError(streamError)) {
            // Not fallbackable - send error and exit
            console.error('[HTTPServer] Error not fallbackable, sending error event');
            res.write(`event: error\ndata: ${JSON.stringify({
              content: streamError?.message || 'An error occurred during processing'
            })}\n\n`);
            break fallbackLoop;
          }

          // Try to find next model
          const nextModel = findNextModel(config, currentModelName, triedModels);
          if (!nextModel) {
            // No more models to try
            console.error('[HTTPServer] All models exhausted, no fallback available');
            res.write(`event: error\ndata: ${JSON.stringify({
              content: '⚠️ 所有可用模型均无法响应，请稍后重试或检查模型配置。'
            })}\n\n`);
            break fallbackLoop;
          }

          // Found fallback model
          fallbackCount++;
          console.log(`[HTTPServer] Fallback #${fallbackCount}: ${currentModelName} -> ${nextModel.name}`);
          triedModels.add(nextModel.name);

          // Send system event to notify frontend
          const fallbackNotice = `⚠️ **${currentModelName}** 不可用，已自动切换至 **${nextModel.name}**`;
          res.write(`event: system\ndata: ${JSON.stringify({
            subtype: 'model_fallback',
            content: fallbackNotice,
            from: currentModelName,
            to: nextModel.name
          })}\n\n`);
          (res as any).flush?.();

          // Create new runner with fallback model
          const cwd = workDirManager.getCurrentWorkDir();
          currentRunner = new UnifiedAgentRunner(options.toolRegistry, {
            model: nextModel.name,
            maxIterations: 0,
            approvalMode: session.approvalMode || 'dangerous',
            skillsLoader: options.skillsLoader,
            cwd,
          });

          // Update runner cache so subsequent requests use the working model
          activeAgentRunners.set(session.id, currentRunner);
          currentModelName = nextModel.name;

          // Reset streaming state for new model
          fullContent = '';
          collectedThinking = '';
          collectedToolStatus = [];

          // Continue loop to try with new model
        }
      }

      res.end();

      // Cleanup temporary vision runner
      if (visionRunner) {
        visionRunner.dispose?.();
        console.log('[HTTPServer] Vision runner disposed');
      }
```

- [ ] **Step 4: Verify the server still compiles**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add src/agents/model-error-detector.ts src/channels/http-ws/http-server.ts
git commit -m "feat(http-server): add model fallback loop with SSE notification

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Frontend System Event Handler

### Task 3: Add System Event Handler in App.tsx

**Files:**
- Modify: `web-ui/src/App.tsx` (around line 2000)

- [ ] **Step 1: Locate the SSE event handling section**

Find the block that handles `permission` event (around line 1998). The `system` event handler should be added after it.

- [ ] **Step 2: Add system event handler**

After the `permission` event handler block (around line 2007), add:

```typescript
              // 处理 system 事件（视觉切换、模型 fallback 通知）
              if (currentEvent === 'system') {
                console.log('[App] System event received:', parsed);
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

- [ ] **Step 3: Commit**

```bash
git add web-ui/src/App.tsx
git commit -m "feat(frontend): add system event handler for model fallback

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Warning Toast Component

### Task 4: Add Warning Style to Toast Component

**Files:**
- Modify: `web-ui/src/components/Toast.tsx`

- [ ] **Step 1: Extend ToastItem interface**

Change the `ToastItem` interface to add optional `type` field:

```typescript
export interface ToastItem {
  id: string;
  content: string;
  category?: string;
  type?: 'memory' | 'warning';  // Add this line
}
```

- [ ] **Step 2: Create WarningToast component**

Add a new component after `MemoryToast`:

```typescript
interface WarningToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function WarningToast({ toast, onDismiss }: WarningToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const truncated = toast.content.length > 60
    ? toast.content.slice(0, 60) + '…'
    : toast.content;

  return (
    <div className="pointer-events-auto flex items-start gap-2 bg-amber-950 border border-amber-600 text-amber-100 rounded-lg px-3 py-2.5 shadow-lg min-w-48 max-w-80 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <span className="text-sm mt-0.5 flex-shrink-0">⚠️</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-amber-300">模型已自动切换</div>
        <div className="text-xs text-amber-200 mt-0.5 break-words">{truncated}</div>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 text-amber-400 hover:text-amber-200 transition-colors mt-0.5"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Update ToastContainer to render both types**

Replace the `ToastContainer` function:

```typescript
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        toast.type === 'warning'
          ? <WarningToast key={toast.id} toast={toast} onDismiss={onDismiss} />
          : <MemoryToast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify frontend compiles**

Run: `npm run build:ui`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add web-ui/src/components/Toast.tsx
git commit -m "feat(ui): add warning toast style for model fallback notifications

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Integration Testing

### Task 5: Manual Integration Test

- [ ] **Step 1: Start development server**

Run: `npm run dev`

- [ ] **Step 2: Test fallback scenario**

1. Configure two models in `config/config.json` (e.g., modelA with invalid API key that returns 429, modelB valid)
2. Open Web UI
3. Send a message
4. Verify: See `system` event with fallback notice in chat
5. Verify: See amber warning Toast in bottom-right
6. Verify: Response comes from modelB
7. Send another message in same session
8. Verify: Uses modelB (runner cache updated)

- [ ] **Step 3: Test all-models-exhausted scenario**

1. Configure all models with invalid endpoints
2. Send a message
3. Verify: See error message "所有可用模型均无法响应"

- [ ] **Step 4: Test auth error does not trigger fallback**

1. Configure model with 401 error
2. Send a message
3. Verify: See raw error, no fallback attempt

- [ ] **Step 5: Final commit if needed**

```bash
git status
# If any changes:
git add -A
git commit -m "chore: integration test cleanup

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Error detection module | `src/agents/model-error-detector.ts`, `src/agents/__tests__/model-error-detector.test.ts` |
| 2 | Backend fallback loop | `src/channels/http-ws/http-server.ts` |
| 3 | Frontend system handler | `web-ui/src/App.tsx` |
| 4 | Warning toast style | `web-ui/src/components/Toast.tsx` |
| 5 | Integration testing | Manual verification |