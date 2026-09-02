import { screenServiceNote } from '@white-glove/tms-db';

export async function screenNoteWithOptionalBedrock(input: {
  notes: string;
  attendance: string;
  beginTime: string;
  endTime: string;
  makeupOfSessionId: string;
  dateOfService: string;
}): Promise<{ flags: string[]; block: boolean; source: 'heuristic' | 'bedrock' }> {
  const local = screenServiceNote(input);
  const model = process.env.TMS_BEDROCK_MODEL_ID?.trim();
  if (!model) return { ...local, source: 'heuristic' };
  try {
    const extra = await invokeBedrockFlags(model, input);
    return {
      flags: [...new Set([...local.flags, ...extra])],
      block: false,
      source: 'bedrock',
    };
  } catch {
    return { ...local, source: 'heuristic' };
  }
}

async function invokeBedrockFlags(
  modelId: string,
  input: Record<string, string>,
): Promise<string[]> {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({});
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `Screen this related-service note for completeness, compliance, and inconsistencies. Return JSON only: {"flags":["..."]}. Never block payroll. Input: ${JSON.stringify(input)}`,
      },
    ],
  };
  const out = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    }),
  );
  const raw = JSON.parse(Buffer.from(out.body).toString('utf8')) as {
    content?: Array<{ text?: string }>;
  };
  const text = raw.content?.[0]?.text || '{}';
  const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}') as { flags?: string[] };
  return Array.isArray(parsed.flags) ? parsed.flags.map(String) : [];
}
