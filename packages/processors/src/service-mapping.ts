import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

/** HHA IDs saved when a service line is opened — used for safe per-service discharge. */
export interface HhaServiceMapping {
  caseId: string;
  serviceCode: string;
  startDate: string;
  patientId: string;
  placementId: string;
  authorizationId?: string;
  contractId?: string;
  updatedAt: string;
}

export interface ServiceMappingStore {
  get(
    caseId: string,
    serviceCode: string,
    startDate: string,
  ): Promise<HhaServiceMapping | undefined>;
  put(mapping: HhaServiceMapping): Promise<void>;
}

export function serviceMappingKeys(
  caseId: string,
  serviceCode: string,
  startDate: string,
): { pk: string; sk: string } {
  const svc = serviceCode.trim().toUpperCase();
  const start = startDate.trim();
  return { pk: `map#${caseId}`, sk: `${svc}#${start}` };
}

export class InMemoryServiceMappingStore implements ServiceMappingStore {
  private readonly items = new Map<string, HhaServiceMapping>();

  async get(
    caseId: string,
    serviceCode: string,
    startDate: string,
  ): Promise<HhaServiceMapping | undefined> {
    const { pk, sk } = serviceMappingKeys(caseId, serviceCode, startDate);
    return this.items.get(`${pk}#${sk}`);
  }

  async put(mapping: HhaServiceMapping): Promise<void> {
    const { pk, sk } = serviceMappingKeys(
      mapping.caseId,
      mapping.serviceCode,
      mapping.startDate,
    );
    this.items.set(`${pk}#${sk}`, mapping);
  }
}

export class DynamoServiceMappingStore implements ServiceMappingStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, client?: DynamoDBClient) {
    this.tableName = tableName;
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async get(
    caseId: string,
    serviceCode: string,
    startDate: string,
  ): Promise<HhaServiceMapping | undefined> {
    const { pk, sk } = serviceMappingKeys(caseId, serviceCode, startDate);
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      }),
    );
    if (!res.Item) return undefined;
    return res.Item as HhaServiceMapping;
  }

  async put(mapping: HhaServiceMapping): Promise<void> {
    const { pk, sk } = serviceMappingKeys(
      mapping.caseId,
      mapping.serviceCode,
      mapping.startDate,
    );
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk, sk, ...mapping },
      }),
    );
  }
}

export function createServiceMappingStore(tableName?: string): ServiceMappingStore {
  if (tableName) return new DynamoServiceMappingStore(tableName);
  return new InMemoryServiceMappingStore();
}
