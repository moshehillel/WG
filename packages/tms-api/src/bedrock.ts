import { screenServiceNote } from '@white-glove/tms-db';

export async function screenNoteWithOptionalBedrock(input: {
  notes: string;
  attendance: string;
  beginTime: string;
  endTime: string;
  makeupOfSessionId: string;
  dateOfService: string;
}): Promise<{
  flags: string[];
  blockFlags: string[];
  warnFlags: string[];
  block: boolean;
  source: 'heuristic' | 'bedrock';
}> {
  const local = screenServiceNote(input);
  const model = process.env.TMS_BEDROCK_MODEL_ID?.trim();
  if (!model) return { ...local, source: 'heuristic' };
  try {
    const extra = await invokeBedrockFlags(model, input);
    const blockFlags = [...new Set([...local.blockFlags, ...extra.blockFlags])];
    const warnFlags = [...new Set([...local.warnFlags, ...extra.warnFlags])];
    const flags = [...new Set([...blockFlags, ...warnFlags])];
    return {
      flags,
      blockFlags,
      warnFlags,
      block: blockFlags.length > 0,
      source: 'bedrock',
    };
  } catch {
    return { ...local, source: 'heuristic' };
  }
}

async function invokeBedrockFlags(
  modelId: string,
  input: Record<string, string>,
): Promise<{ blockFlags: string[]; warnFlags: string[] }> {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({});
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `Screen this related-service note for compliance and inconsistencies. Return JSON only: {"flags":[{"message":"...","severity":"block"|"warn"}]}. Use severity "block" for empty/missing notes (when attendance is attended or makeup), missing times, placeholder text (lorem ipsum / asdf), or real compliance problems — NOT for brevity alone (very short notes of a few words are allowed). "warn" only for soft suggestions. If you omit severity, the flag is treated as a block. Input: ${JSON.stringify(input)}`,
      },
    ],
  };
  // Keep Send timesheet under Netlify proxy limits; on timeout, caller falls back to heuristic.
  const out = await Promise.race([
    client.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: Buffer.from(JSON.stringify(body)),
      }),
    ),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Bedrock note screen timed out')), 8000);
    }),
  ]);
  const raw = JSON.parse(Buffer.from(out.body).toString('utf8')) as {
    content?: Array<{ text?: string }>;
  };
  const text = raw.content?.[0]?.text || '{}';
  const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}') as {
    flags?: Array<string | { message?: string; severity?: string }>;
  };
  const blockFlags: string[] = [];
  const warnFlags: string[] = [];
  for (const item of Array.isArray(parsed.flags) ? parsed.flags : []) {
    if (typeof item === 'string') {
      if (item.trim()) blockFlags.push(item);
      continue;
    }
    const message = String(item?.message || '').trim();
    if (!message) continue;
    if (String(item?.severity || '').toLowerCase() === 'warn') warnFlags.push(message);
    else blockFlags.push(message);
  }
  return { blockFlags, warnFlags };
}
