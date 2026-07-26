export type {
  ClosedCaseUpdate,
  DischargeAllPlacementsOptions,
  DischargePlacementOptions,
  DischargeServiceUpdate,
  HhaClient,
  PatientPlacementSummary,
  UpsertResult,
} from './types.js';
export { activePlacements, parsePatientPlacements } from './placements.js';
export type { PatientPlacement } from './placements.js';
export { resolvePlacementForService } from './resolve-placement.js';
export { AmbiguousPatientNameError } from './patient-errors.js';
export { MockHhaClient } from './mock-client.js';
export { HttpHhaClient } from './http-client.js';
export type { HttpHhaClientOptions } from './http-client.js';
export { HhaSoapClient } from './soap-client.js';
export type { HhaSoapAuth, HhaSoapClientOptions, SoapCallResult } from './soap-client.js';
export { SoapHhaClientAdapter } from './soap-adapter.js';
export type { SoapHhaClientAdapterOptions } from './soap-adapter.js';
export { createHhaClient } from './factory.js';
export { applyHhaSecretFromArn } from './load-secret.js';
export {
  compareSessionClock,
  psDateToIso,
  psTimeToHhmm,
  sessionDurationMinutes,
  splitProviderName,
} from './hha-time.js';
export {
  buildCreatePatientBody,
  canCreatePatient,
  createPatientDefaultsFromEnv,
  formatAdmissionId,
  mapServiceToDiscipline,
} from './create-patient-builder.js';
export type { CreatePatientDefaults, CreatePatientReferenceIds } from './create-patient-builder.js';

