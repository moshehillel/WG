import { noteNeedsAbsenceFallback, screenServiceNote } from '@white-glove/tms-db';

const HAIKU_45_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const RETIRED_HAIKU_MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

function bedrockModelId(): string {
  const configured = process.env.TMS_BEDROCK_MODEL_ID?.trim() || '';
  if (!configured) return '';
  if (configured === RETIRED_HAIKU_MODEL_ID) return HAIKU_45_MODEL_ID;
  return configured;
}

export function absenceFallbackWarning(
  storedAttendance: string,
  modelAttendance: string,
): string {
  const stored = String(storedAttendance || '').trim().toLowerCase();
  const model = String(modelAttendance || '').trim().toLowerCase();
  if (stored !== 'attended') return '';
  if (model === 'missed') {
    return 'This note reads as a missed visit, but attendance is marked attended.';
  }
  if (model === 'makeup') {
    return 'This note reads as a makeup visit, but attendance is marked attended.';
  }
  if (model === 'paid_absence' || model === 'paid absence') {
    return 'This note reads as a paid absence, but attendance is marked attended.';
  }
  return '';
}

export function absenceFallbackPrompt(input: {
  notes: string;
  beginTime: string;
  endTime: string;
}): string {
  return (
    'Classify this therapy session note. Reply with JSON only: {"attendance":"attended"|"missed"|"makeup"|"paid_absence"}. ' +
    'missed means the child or provider was not there and no therapy was delivered. ' +
    'paid_absence means the note says paid absence (for example "Student Not Available: Paid absence.") and the visit stays payable with its clock times. ' +
    'makeup means this visit is making up an earlier missed visit. ' +
    'attended means therapy was delivered, even if a partner was absent or the note mentions missing a turn or past missed work. ' +
    `Times: ${input.beginTime || '(none)'} to ${input.endTime || '(none)'}. Note: ${input.notes}`
  );
}

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
  const model = bedrockModelId();
  // Rules already decided, or the note has no absence wording. Do not call the model.
  if (local.block || !model || !noteNeedsAbsenceFallback(input)) {
    return { ...local, source: 'heuristic' };
  }
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

export async function invokeClaudeText(
  prompt: string,
  maxTokens: number,
  timeoutMs = 8000,
): Promise<string> {
  const modelId = bedrockModelId();
  if (!modelId) throw new Error('Claude reading is not configured.');
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({});
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
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
      setTimeout(() => reject(new Error('Claude reading timed out')), timeoutMs);
    }),
  ]);
  const raw = JSON.parse(Buffer.from(out.body).toString('utf8')) as {
    content?: Array<{ text?: string }>;
  };
  return raw.content?.[0]?.text || '';
}

async function invokeBedrockAttendance(
  modelId: string,
  input: { notes: string; beginTime: string; endTime: string },
): Promise<string> {
  if (!modelId) return '';
  const text = await invokeClaudeText(absenceFallbackPrompt(input), 400, 8000);
  const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}') as {
    attendance?: string;
  };
  return String(parsed.attendance || '').trim().toLowerCase();
}

async function invokeBedrockFlags(
  modelId: string,
  input: Record<string, string>,
): Promise<{ blockFlags: string[]; warnFlags: string[] }> {
  const attendance = await invokeBedrockAttendance(modelId, input);
  const warning = absenceFallbackWarning(input.attendance, attendance);
  return { blockFlags: [], warnFlags: warning ? [warning] : [] };
}

/** Reads one note. Empty string means the model was not called or did not answer. */
export async function classifyNoteAttendance(input: {
  notes: string;
  beginTime: string;
  endTime: string;
}): Promise<'attended' | 'missed' | 'makeup' | 'paid_absence' | ''> {
  const model = bedrockModelId();
  if (!model) return '';
  try {
    const attendance = await invokeBedrockAttendance(model, input);
    const normalized = String(attendance || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (
      normalized === 'attended' ||
      normalized === 'missed' ||
      normalized === 'makeup' ||
      normalized === 'paid_absence'
    ) {
      return normalized;
    }
    return '';
  } catch {
    return '';
  }
}
