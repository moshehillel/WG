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

export async function getPdfFromS3(key: string): Promise<Buffer | null> {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket || !key) return null;
  const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await out.Body?.transformToByteArray();
    if (!bytes) return null;
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}

export async function deletePdfFromS3(key: string): Promise<void> {
  const bucket = process.env.REPORTS_BUCKET;
  if (!bucket || !key) return;
  const { DeleteObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    /* best-effort — metadata delete still proceeds */
  }
}
