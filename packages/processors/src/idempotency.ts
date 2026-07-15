import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

export interface IdempotencyStore {
  alreadyProcessed(pk: string, sk: string): Promise<boolean>;
  markProcessed(pk: string, sk: string, meta?: Record<string, unknown>): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly keys = new Set<string>();

  async alreadyProcessed(pk: string, sk: string): Promise<boolean> {
    return this.keys.has(`${pk}#${sk}`);
  }

  async markProcessed(pk: string, sk: string): Promise<void> {
    this.keys.add(`${pk}#${sk}`);
  }
}

export class DynamoIdempotencyStore implements IdempotencyStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, client?: DynamoDBClient) {
    this.tableName = tableName;
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async alreadyProcessed(pk: string, sk: string): Promise<boolean> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      }),
    );
    return Boolean(res.Item);
  }

  async markProcessed(pk: string, sk: string, meta?: Record<string, unknown>): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk,
          sk,
          processedAt: new Date().toISOString(),
          ...meta,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    ).catch((err: { name?: string }) => {
      if (err.name === 'ConditionalCheckFailedException') return;
      throw err;
    });
  }
}

export function createIdempotencyStore(tableName?: string): IdempotencyStore {
  if (tableName) return new DynamoIdempotencyStore(tableName);
  return new InMemoryIdempotencyStore();
}

export function rowKey(reportKind: string, rowId: string): { pk: string; sk: string } {
  return { pk: `row#${reportKind}`, sk: rowId };
}
