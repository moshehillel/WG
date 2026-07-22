import { errorMessage } from '@white-glove/shared';
import type { BotReportKind } from './report-config.js';

export type DownloadFailureStage =
  | 'login'
  | 'playwright_report'
  | 'http_fallback'
  | 'http_login'
  | 'no_reports'
  | 'upload'
  | 'handler';

export class DownloadFailureError extends Error {
  readonly stage: DownloadFailureStage;
  readonly reportKind?: BotReportKind;
  readonly attempts?: number;
  readonly userReportId?: string;
  readonly causeDetail: string;

  constructor(options: {
    stage: DownloadFailureStage;
    reportKind?: BotReportKind;
    attempts?: number;
    userReportId?: string;
    cause: unknown;
  }) {
    const causeDetail = errorMessage(options.cause);
    const parts = ['ProviderSoft download failed'];
    if (options.reportKind) parts.push(`report=${options.reportKind}`);
    parts.push(`stage=${options.stage}`);
    if (options.attempts !== undefined) parts.push(`attempts=${options.attempts}`);
    if (options.userReportId) parts.push(`UserReportId=${options.userReportId}`);
    parts.push(`reason=${causeDetail}`);

    super(parts.join(' | '));
    this.name = 'DownloadFailureError';
    this.stage = options.stage;
    this.reportKind = options.reportKind;
    this.attempts = options.attempts;
    this.userReportId = options.userReportId;
    this.causeDetail = causeDetail;
  }
}
