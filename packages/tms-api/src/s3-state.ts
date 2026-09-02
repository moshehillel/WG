import { MemoryStore, type TmsSnapshot } from '@white-glove/tms-db';

const KEY = 'tms/state.json';

export async function loadSnapshotFromS3(store: MemoryStore): Promise<void> {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket) return;
  const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: KEY }));
    const text = await out.Body?.transformToString();
    if (!text) return;
    store.load(JSON.parse(text) as TmsSnapshot);
  } catch {
    /* first run — empty store */
  }
}

export async function saveSnapshotToS3(store: MemoryStore): Promise<void> {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket) return;
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: KEY,
      Body: JSON.stringify(store.snapshot()),
      ContentType: 'application/json',
    }),
  );
}

export async function putLockerPdf(key: string, body: Buffer): Promise<void> {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket) return;
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/pdf',
    }),
  );
}
