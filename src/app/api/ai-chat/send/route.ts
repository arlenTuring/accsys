import { getCurrentEmployee } from '@/lib/auth/current-employee';
import type { ChatProgressEvent } from '@/lib/ai-chat/progress';
import { runAssistantTurn, type AssistantTurnInput } from '@/lib/ai-chat/turn';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SSE stream for one assistant turn: progress steps, then a final `result` or `error` event.
 * Body matches AssistantTurnInput (JSON).
 */
export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return new Response(JSON.stringify({ type: 'error', error: '請先登入。' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let input: AssistantTurnInput;
  try {
    input = (await request.json()) as AssistantTurnInput;
  } catch {
    return new Response(JSON.stringify({ type: 'error', error: '無法讀取請求內容。' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const heartbeat = setInterval(() => {
        try {
          send({ type: 'heartbeat', at: Date.now() } satisfies ChatProgressEvent);
        } catch {
          /* closed */
        }
      }, 15000);

      try {
        const result = await runAssistantTurn(employee, input, {
          onProgress: (event) => send(event),
        });
        send({ type: 'result', result });
      } catch (err) {
        send({
          type: 'error',
          error: err instanceof Error ? err.message : '處理失敗，請稍後再試。',
        });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
