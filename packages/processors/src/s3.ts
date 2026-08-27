import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export async function getObjectText(bucket: string, key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body?.transformToString('utf-8');
  if (body === undefined) throw new Error(`Empty S3 object s3://${bucket}/${key}`);
  return body;
}

/** List all object metadata under a prefix (paginated). */
export async function listAllObjects(
  bucket: string,
  prefix: string,
): Promise<_Object[]> {
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    if (res.Contents?.length) out.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function putJson(bucket: string, key: string, value: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
    }),
  );
}

export async function putText(
  bucket: string,
  key: string,
  body: string,
  contentType = 'text/plain',
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
