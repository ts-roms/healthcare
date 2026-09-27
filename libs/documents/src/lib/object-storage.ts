import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "@healthcare/core";

export interface PresignedUpload {
  url: string;
  method: "PUT";
  /** Headers the client must send with the upload, exactly as given. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType?: string;
}

/**
 * Private object storage port. Objects are never public; clients get
 * short-lived presigned URLs issued after an authorization check.
 */
export interface ObjectStorage {
  presignUpload(key: string, contentType: string, sizeBytes: number, expiresInSeconds: number): Promise<PresignedUpload>;
  presignDownload(key: string, fileName: string, contentType: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<StoredObjectInfo | undefined>;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async presignUpload(key: string, contentType: string, sizeBytes: number, expiresInSeconds: number): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
      ServerSideEncryption: "AES256",
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(sizeBytes), "x-amz-server-side-encryption": "AES256" },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  presignDownload(key: string, fileName: string, contentType: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: contentDisposition(fileName),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async head(key: string): Promise<StoredObjectInfo | undefined> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (error instanceof NotFound || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined;
      throw error;
    }
  }
}

/** For tests and local runs without object storage. */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObjectInfo>();

  async presignUpload(key: string, contentType: string, sizeBytes: number, expiresInSeconds: number): Promise<PresignedUpload> {
    return {
      url: `memory://upload/${encodeURIComponent(key)}`,
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(sizeBytes) },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async presignDownload(key: string, fileName: string): Promise<string> {
    return `memory://download/${encodeURIComponent(key)}?name=${encodeURIComponent(fileName)}`;
  }

  async head(key: string): Promise<StoredObjectInfo | undefined> {
    return this.objects.get(key);
  }

  /** Simulates the client completing the presigned upload. */
  put(key: string, info: StoredObjectInfo): void {
    this.objects.set(key, info);
  }
}

/** RFC 6266 attachment disposition with a UTF-8 file name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
