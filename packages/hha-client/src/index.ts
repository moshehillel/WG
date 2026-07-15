export type { ClosedCaseUpdate, HhaClient, UpsertResult } from './types.js';
export { MockHhaClient } from './mock-client.js';
export { HttpHhaClient } from './http-client.js';
export type { HttpHhaClientOptions } from './http-client.js';
export { HhaSoapClient } from './soap-client.js';
export type { HhaSoapAuth, HhaSoapClientOptions, SoapCallResult } from './soap-client.js';
export { SoapHhaClientAdapter } from './soap-adapter.js';
export type { SoapHhaClientAdapterOptions } from './soap-adapter.js';
export { createHhaClient } from './factory.js';
export { applyHhaSecretFromArn } from './load-secret.js';

