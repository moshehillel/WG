export type {
  ClosedCaseUpdate,
  DischargeAllPlacementsOptions,
  DischargePlacementOptions,
  DischargeServiceUpdate,
  FindPatientOptions,
  HhaClient,
  PatientDemoFields,
  PatientPlacementSummary,
  UpsertResult,
} from './types.js';
export { activePlacements, parsePatientPlacements } from './placements.js';
export type { PatientPlacement } from './placements.js';
export { resolvePlacementForService } from './resolve-placement.js';
export { AmbiguousPatientNameError } from './patient-errors.js';
export {
  isAlreadyDischargedError,
  isTrustedHhaPatientId,
  toFindPatientOptions,
} from './resolve-patient-id.js';
export { MockHhaClient } from './mock-client.js';
export { HttpHhaClient } from './http-client.js';
export type { HttpHhaClientOptions } from './http-client.js';
export { HhaSoapClient } from './soap-client.js';
export type { HhaSoapAuth, HhaSoapClientOptions, SoapCallResult } from './soap-client.js';
export { SoapHhaClientAdapter } from './soap-adapter.js';
export type { SoapHhaClientAdapterOptions } from './soap-adapter.js';
export { createHhaClient } from './factory.js';
export type { HhaReferenceCache } from './reference-cache.js';
export { InMemoryHhaReferenceCache } from './reference-cache.js';
export {
  ENT_GRAPHQL_URL,
  appsyncAuthHeaders,
  buildUnscheduledServicesQuery,
  decodeJwtExp,
  entGraphqlConfigFromEnv,
  fetchAllUnscheduledServices,
  fetchUnscheduledPage,
  spaTokenFromEnv,
} from './ent-graphql.js';
export type { EntGraphqlConfig } from './ent-graphql.js';
export { ensureEntSpaToken, persistEntAuthToSecret } from './ensure-ent-spa-token.js';
export {
  fetchServiceCoordinators,
  resolveEntCoordinatorIds,
} from './resolve-ent-coordinators.js';
export {
  completeHhaMfaRenewal,
  mfaStatusFromEnv,
  startHhaMfaRenewal,
} from './mfa-renew.js';
export type { MfaCookieStatus } from './mfa-renew.js';
export { loginEntHttp, oidcEntBearer, bootstrapEntApis, startEntFreshLoginToMfa, sendEntMfaOtp, completeEntMfaLogin } from './ent-http-login.js';
export { captureEntSpaToken } from './ent-spa-capture.js';
export { EntCookieJar } from './ent-cookie-jar.js';
export type { EntCookie } from './ent-cookie-jar.js';
export { applyHhaSecretFromArn } from './load-secret.js';
export { applySandboxHhaReads, applySandboxHhaWrites, HHA_SANDBOX_SOAP_URL } from './sandbox-hha-env.js';
export {
  compareSessionClock,
  psDateToIso,
  psDateTimeIso,
  psDateTimeSpace,
  psTimeToHhmm,
  sessionDurationMinutes,
  splitProviderName,
  caregiverSearchNameOrders,
} from './hha-time.js';
export {
  buildGetAcsCallInfoQuery,
  buildGetCreateVisitQuery,
  buildCreateVisitFromUnscheduledMutation,
  buildCreateVisitInputFromSession,
  createVisitFromUnscheduledServices,
  fetchAcsCallInfo,
  fetchCreateVisitDefaults,
  pickCreateVisitIds,
} from './ent-create-visit.js';
export type {
  AcsEvvCallInfo,
  CreateVisitFromUnscheduledInput,
  CreateVisitFromUnscheduledResult,
  GetCreateVisitDefaults,
} from './ent-create-visit.js';
export { entGraphqlRequest } from './ent-graphql-request.js';
export {
  resolveVisitForUnscheduledClock,
} from './unscheduled-visit-flow.js';
export type {
  ResolveUnscheduledVisitOptions,
  ResolveUnscheduledVisitResult,
  UnscheduledVisitSource,
} from './unscheduled-visit-flow.js';
export {
  buildCreatePatientBody,
  canCreatePatient,
  createPatientDefaultsFromEnv,
  formatAdmissionId,
  mapServiceToDiscipline,
  normalizeHhaGender,
  stripLeadingZerosFromNumericId,
} from './create-patient-builder.js';
export type { CreatePatientDefaults, CreatePatientReferenceIds } from './create-patient-builder.js';

