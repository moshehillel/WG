import { XMLParser } from 'fast-xml-parser';

const NS = 'https://www.hhaexchange.com/apis/hhaws.integration';
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) =>
    ['PatientID', 'Patient', 'Visit', 'Contract', 'Authorization', 'Duty', 'Office'].includes(name),
});

export interface HhaSoapAuth {
  appName: string;
  appSecret: string;
  appKey: string;
}

export interface HhaSoapClientOptions {
  baseUrl: string;
  auth: HhaSoapAuth;
  fetchImpl?: typeof fetch;
}

export interface SoapCallResult {
  ok: boolean;
  status?: string;
  errorId?: string;
  errorMessage?: string;
  raw: unknown;
  bodyXml: string;
}

function authXml(auth: HhaSoapAuth): string {
  return `<Authentication>
  <AppName>${escapeXml(auth.appName)}</AppName>
  <AppSecret>${escapeXml(auth.appSecret)}</AppSecret>
  <AppKey>${escapeXml(auth.appKey)}</AppKey>
</Authentication>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unwrapResult(parsed: Record<string, unknown>, method: string): Record<string, unknown> {
  const envelope = parsed.Envelope as Record<string, unknown> | undefined;
  const body = (envelope?.Body ?? parsed.Body) as Record<string, unknown> | undefined;
  if (!body) return parsed;
  const response = body[`${method}Response`] as Record<string, unknown> | undefined;
  if (!response) return body;
  const result = response[`${method}Result`] as Record<string, unknown> | undefined;
  return result ?? response;
}

function interpretStatus(result: Record<string, unknown>): Pick<
  SoapCallResult,
  'ok' | 'status' | 'errorId' | 'errorMessage'
> {
  const status = String(result.Status ?? result['@_Status'] ?? result.status ?? '');
  const errorId = result.ErrorID !== undefined ? String(result.ErrorID) : undefined;
  const errorMessage =
    result.ErrorMessage !== undefined
      ? String(result.ErrorMessage)
      : result.Comments !== undefined
        ? String(result.Comments)
        : undefined;
  const ok = status.toLowerCase() === 'success' || (status === '' && !errorId);
  return { ok, status: status || undefined, errorId, errorMessage };
}

export class HhaSoapClient {
  private readonly endpoint: string;
  private readonly auth: HhaSoapAuth;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HhaSoapClientOptions) {
    this.endpoint = options.baseUrl.replace(/\?.*$/, '').replace(/\/$/, '');
    // Sandbox-first: block production unless explicitly opted in.
    if (
      /app\.hhaexchange\.com/i.test(this.endpoint) &&
      process.env.HHA_ALLOW_PRODUCTION !== 'true'
    ) {
      throw new Error(
        'Production HHA URL blocked. Use sandbox1.hhaexchange.com, or set HHA_ALLOW_PRODUCTION=true when go-live is approved.',
      );
    }
    this.auth = options.auth;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(method: string, innerBody: string): Promise<SoapCallResult> {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      ${authXml(this.auth)}
      ${innerBody}
    </${method}>
  </soap:Body>
</soap:Envelope>`;

    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${NS}/${method}"`,
      },
      body: envelope,
    });

    const bodyXml = await res.text();
    const parsed = parser.parse(bodyXml) as Record<string, unknown>;
    const result = unwrapResult(parsed, method);

    // HHA often returns HTTP 400 with a SOAP body containing Result Status=Failure.
    if (result && typeof result === 'object') {
      const nestedResult = (result as { Result?: Record<string, unknown> }).Result;
      if (nestedResult) {
        const errorInfo = nestedResult.ErrorInfo as Record<string, unknown> | undefined;
        // fast-xml-parser puts attributes as @_Status
        const status = String(nestedResult.Status ?? nestedResult['@_Status'] ?? '');
        return {
          ok: status.toLowerCase() === 'success',
          status: status || undefined,
          errorId: errorInfo?.ErrorID !== undefined ? String(errorInfo.ErrorID) : undefined,
          errorMessage:
            errorInfo?.ErrorMessage !== undefined ? String(errorInfo.ErrorMessage) : undefined,
          raw: result,
          bodyXml,
        };
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: 'HttpError',
        errorId: String(res.status),
        errorMessage: bodyXml.slice(0, 500),
        raw: result,
        bodyXml,
      };
    }

    return {
      ...interpretStatus(result),
      raw: result,
      bodyXml,
    };
  }

  getOffices(): Promise<SoapCallResult> {
    return this.call('GetOffices', '');
  }

  getContracts(): Promise<SoapCallResult> {
    return this.call('GetContracts', '');
  }

  getDisciplines(): Promise<SoapCallResult> {
    return this.call('GetDisciplines', '');
  }

  getContractServiceCode(contractId: number): Promise<SoapCallResult> {
    return this.call('GetContractServiceCode', `<ContractID>${contractId}</ContractID>`);
  }

  searchPatients(filters: {
    firstName?: string;
    lastName?: string;
    status?: string;
    mrNumber?: string;
    admissionId?: string;
  }): Promise<SoapCallResult> {
    return this.call(
      'SearchPatients',
      `<SearchFilters>
  <FirstName>${escapeXml(filters.firstName ?? '')}</FirstName>
  <LastName>${escapeXml(filters.lastName ?? '')}</LastName>
  <Status>${escapeXml(filters.status ?? '')}</Status>
  <PhoneNumber></PhoneNumber>
  <AdmissionID>${escapeXml(filters.admissionId ?? '')}</AdmissionID>
  <MRNumber>${escapeXml(filters.mrNumber ?? '')}</MRNumber>
  <SSN></SSN>
</SearchFilters>`,
    );
  }

  getPatientDemographics(patientId: number): Promise<SoapCallResult> {
    return this.call(
      'GetPatientDemographics',
      `<PatientInfo><ID>${patientId}</ID></PatientInfo>`,
    );
  }

  getPatientContracts(patientId: number, visitDate: string): Promise<SoapCallResult> {
    // ASMX requires a real VisitDate (empty string → SOAP fault). Flat params, not wrapped.
    return this.call(
      'GetPatientContracts',
      `<PatientID>${patientId}</PatientID>
  <VisitDate>${escapeXml(visitDate)}</VisitDate>`,
    );
  }

  searchVisits(filters: {
    patientId?: number;
    caregiverId?: number;
    officeId?: number;
    startDate: string;
    endDate: string;
  }): Promise<SoapCallResult> {
    // Do not send CaregiverID=0 (Invalid caregiver ID). Office searches max 1-day range.
    const parts = [
      `<StartDate>${escapeXml(filters.startDate)}</StartDate>`,
      `<EndDate>${escapeXml(filters.endDate)}</EndDate>`,
    ];
    if (filters.patientId) parts.push(`<PatientID>${filters.patientId}</PatientID>`);
    if (filters.caregiverId) parts.push(`<CaregiverID>${filters.caregiverId}</CaregiverID>`);
    if (filters.officeId) parts.push(`<OfficeID>${filters.officeId}</OfficeID>`);
    return this.call('SearchVisits', `<SearchFilters>\n  ${parts.join('\n  ')}\n</SearchFilters>`);
  }

  getVisitInfoV2(visitId: number): Promise<SoapCallResult> {
    // ASMX docs show VisitID, but sandbox accepts ID (VisitID returns -415).
    return this.call('GetVisitInfoV2', `<VisitInfo><ID>${visitId}</ID></VisitInfo>`);
  }

  getPatientAuthorizationInfo(patientId: number, authorizationId: number): Promise<SoapCallResult> {
    return this.call(
      'GetPatientAuthorizationInfo',
      `<AuthorizationInfo>
  <PatientID>${patientId}</PatientID>
  <AuthorizationID>${authorizationId}</AuthorizationID>
</AuthorizationInfo>`,
    );
  }
}
