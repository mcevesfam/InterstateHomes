import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage } from '@google-cloud/storage';

const DEFAULT_EXPIRES_SECONDS = 300; // 5-minute private expiring links (Section 4.3)

let gcsStorageSingleton: Storage | null = null;

function getGcsStorage(): Storage | null {
  if (!process.env.GCS_BUCKET) {
    return null;
  }
  if (!gcsStorageSingleton) {
    // Uses Cloud Run Workload Identity / Application Default Credentials (zero static keys).
    gcsStorageSingleton = new Storage();
  }
  return gcsStorageSingleton;
}

function getS3Client(): S3Client | null {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    return null;
  }
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-west-2',
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export function getStorageProvider(): 'gcs' | 's3' | 'mock' {
  if (process.env.GCS_BUCKET) return 'gcs';
  if (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    return 's3';
  }
  return 'mock';
}

export function validateUploadSize(fileSizeBytes: number, maxMb = 250): void {
  const maxBytes = maxMb * 1024 * 1024;
  if (fileSizeBytes > maxBytes) {
    throw new Error(`File exceeds maximum allowed size of ${maxMb} MB.`);
  }
}

export async function getPresignedUploadUrl(
  storageKey: string,
  contentType = 'application/pdf',
  expiresIn = DEFAULT_EXPIRES_SECONDS
): Promise<{ url: string; storageKey: string; expiresIn: number }> {
  const gcs = getGcsStorage();
  if (gcs) {
    const [url] = await gcs
      .bucket(process.env.GCS_BUCKET!)
      .file(storageKey)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresIn * 1000,
        contentType,
      });
    return { url, storageKey, expiresIn };
  }

  const client = getS3Client();
  if (!client) {
    return {
      url: `/api/storage/mock-upload?key=${encodeURIComponent(storageKey)}`,
      storageKey,
      expiresIn,
    };
  }
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: storageKey,
    ContentType: contentType,
  });
  const url = await getSignedUrl(client, command, { expiresIn });
  return { url, storageKey, expiresIn };
}

export async function getPresignedDownloadUrl(
  storageKey: string,
  expiresIn = DEFAULT_EXPIRES_SECONDS
): Promise<{ url: string; expiresIn: number }> {
  const gcs = getGcsStorage();
  if (gcs) {
    const [url] = await gcs
      .bucket(process.env.GCS_BUCKET!)
      .file(storageKey)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      });
    return { url, expiresIn };
  }

  const client = getS3Client();
  if (!client) {
    return {
      url: `/api/storage/mock-download?key=${encodeURIComponent(storageKey)}`,
      expiresIn,
    };
  }
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: storageKey,
  });
  const url = await getSignedUrl(client, command, { expiresIn });
  return { url, expiresIn };
}

export async function uploadBufferToStorage(
  storageKey: string,
  buffer: Buffer,
  contentType: string
): Promise<{ provider: 'gcs' | 's3' | 'mock'; storageKey: string }> {
  const gcs = getGcsStorage();
  if (gcs) {
    await gcs.bucket(process.env.GCS_BUCKET!).file(storageKey).save(buffer, {
      contentType,
      resumable: false,
    });
    return { provider: 'gcs', storageKey };
  }

  const client = getS3Client();
  if (client) {
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: storageKey,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return { provider: 's3', storageKey };
  }

  return { provider: 'mock', storageKey };
}
