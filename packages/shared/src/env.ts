import { z } from 'zod';

export const HhaAuthSchema = z.object({
  PROVIDERSOFT_BASE_URL: z.string().url().optional(),
  PROVIDERSOFT_USERNAME: z.string().optional(),
  PROVIDERSOFT_PASSWORD: z.string().optional(),
  HHA_BASE_URL: z.string().optional(),
  HHA_API_KEY: z.string().optional(),
  HHA_APP_NAME: z.string().optional(),
  HHA_APP_SECRET: z.string().optional(),
  HHA_APP_KEY: z.string().optional(),
  HHA_OFFICE_ID: z.string().optional(),
  HHA_USE_MOCK: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  REPORTS_BUCKET: z.string().optional(),
  IDEMPOTENCY_TABLE: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  LOCAL_DOWNLOAD_DIR: z.string().default('./downloads'),
  HEADLESS: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  EXCEPTION_TOPIC_ARN: z.string().optional(),
  /** Comma-separated SES/SNS alert recipients (ValidateFn result emails). */
  ALERT_EMAILS: z.string().optional(),
  ALERT_FROM_EMAIL: z.string().optional(),
  ALERT_FROM_EMAIL_FALLBACK: z.string().optional(),
  ALERT_FROM_NAME: z.string().optional(),
  /** Human-monitored address for replies (defaults to FROM). */
  ALERT_REPLY_TO: z.string().optional(),
  ALERT_LOGO_URL: z.string().optional(),
});

export type Env = z.infer<typeof HhaAuthSchema>;

let cached: Env | undefined;

export function getEnv(overrides?: Partial<Record<keyof Env, string>>): Env {
  if (cached && !overrides) return cached;
  const raw = { ...process.env, ...overrides };
  const parsed = HhaAuthSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  if (!overrides) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = undefined;
}
