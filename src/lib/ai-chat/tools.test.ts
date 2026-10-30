import { describe, expect, it } from 'vitest';
import { AI_CHAT_ALLOWED_TOOLS, AI_CHAT_TOOL_DECLARATIONS, executeAiChatTool } from './tools';

describe('ai-chat tools', () => {
  it('declares only the allowlisted names', () => {
    const declared = AI_CHAT_TOOL_DECLARATIONS.map((t) => t.name).sort();
    expect(declared).toEqual([...AI_CHAT_ALLOWED_TOOLS].sort());
  });

  it('rejects tools outside the whitelist', async () => {
    const result = await executeAiChatTool('approve_all', {});
    expect(result.ok).toBe(false);
    expect(result.response.error).toBe('unauthorized_tool');
  });
});
