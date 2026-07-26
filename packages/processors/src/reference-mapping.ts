import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  InMemoryHhaReferenceCache,
  type HhaReferenceCache,
} from '@white-glove/hha-client';

function normalizeRefKey(value: string): string {
  return value.trim().toLowerCase();
}

function contractKeys(programType: string): { pk: string; sk: string } {
  return { pk: 'ref#contract', sk: normalizeRefKey(programType) };
}

function serviceKeys(serviceType: string): { pk: string; sk: string } {
  return { pk: 'ref#service', sk: normalizeRefKey(serviceType) };
}

export class DynamoHhaReferenceCache implements HhaReferenceCache {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, client?: DynamoDBClient) {
    this.tableName = tableName;
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async getContractId(programType: string): Promise<number | undefined> {
    const { pk, sk } = contractKeys(programType);
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const id = res.Item?.contractId;
    return id != null ? Number(id) : undefined;
  }

  async putContractId(programType: string, contractId: number): Promise<void> {
    const { pk, sk } = contractKeys(programType);
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk,
          sk,
          programType: programType.trim(),
          contractId,
          updatedAt: new Date().toISOString(),
        },
      }),
    );
  }

  async getServiceCodeId(serviceType: string): Promise<string | undefined> {
    const { pk, sk } = serviceKeys(serviceType);
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    const id = res.Item?.hhaCodeId;
    return id != null ? String(id) : undefined;
  }

  async putServiceCodeId(serviceType: string, hhaCodeId: string): Promise<void> {
    const { pk, sk } = serviceKeys(serviceType);
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk,
          sk,
          serviceType: serviceType.trim(),
          hhaCodeId,
          updatedAt: new Date().toISOString(),
        },
      }),
    );
  }
}

export function createReferenceMappingStore(tableName?: string): HhaReferenceCache {
  if (tableName) return new DynamoHhaReferenceCache(tableName);
  return new InMemoryHhaReferenceCache();
}
