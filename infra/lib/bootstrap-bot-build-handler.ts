import type { Handler } from 'aws-lambda';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const codebuild = new CodeBuildClient({});

/** Default GitHub repo; override with BOT_GITHUB_REPO=owner/name */
const DEFAULT_REPO = 'moshehillel/WG';
const DEFAULT_BRANCH = 'main';

async function downloadGithubArchive(owner: string, repo: string, branch: string): Promise<Buffer> {
  const url = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`GitHub download failed ${res.status} for ${url} — push code to GitHub or set BOT_GITHUB_REPO`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface BootstrapBotBuildEvent {
  branch?: string;
  /** owner/repo */
  githubRepo?: string;
  /** Local source.zip contents (base64) — bypasses GitHub when under Lambda 6MB payload limit */
  zipBase64?: string;
  /** Content hash of bot/shared sources — tagged on ECR as src-<hash> for freshness checks */
  botSourceHash?: string;
}

export const handler: Handler<BootstrapBotBuildEvent, { ok: boolean; buildId?: string; bytes?: number }> =
  async (event) => {
    const bucket = process.env.BOT_SOURCE_BUCKET;
    const project = process.env.BOT_CODEBUILD_PROJECT;
    if (!bucket || !project) {
      throw new Error('BOT_SOURCE_BUCKET and BOT_CODEBUILD_PROJECT env vars required');
    }

    let zip: Buffer;
    if (event.zipBase64) {
      zip = Buffer.from(event.zipBase64, 'base64');
      console.log(`Using inline zip payload (${zip.length} bytes)`);
    } else {
      const repoSpec = process.env.BOT_GITHUB_REPO ?? event.githubRepo ?? DEFAULT_REPO;
      const [owner, repo] = repoSpec.split('/');
      if (!owner || !repo) throw new Error(`Invalid repo "${repoSpec}" — use owner/name`);
      const branch = event.branch ?? process.env.BOT_GITHUB_BRANCH ?? DEFAULT_BRANCH;

      console.log(`Downloading github.com/${owner}/${repo}@${branch} ...`);
      zip = await downloadGithubArchive(owner, repo, branch);
      console.log(`Downloaded ${zip.length} bytes`);
    }

    console.log(`Uploading to s3://${bucket}/source.zip`);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'source.zip',
        Body: zip,
        ContentType: 'application/zip',
      }),
    );

    const hash = event.botSourceHash?.trim();
    const started = await codebuild.send(
      new StartBuildCommand({
        projectName: project,
        ...(hash
          ? {
              environmentVariablesOverride: [
                { name: 'BOT_SOURCE_HASH', value: hash, type: 'PLAINTEXT' },
              ],
            }
          : {}),
      }),
    );
    const buildId = started.build?.id;
    console.log(`Started CodeBuild: ${buildId}${hash ? ` (BOT_SOURCE_HASH=${hash})` : ''}`);

    return { ok: true, buildId, bytes: zip.length };
  };
