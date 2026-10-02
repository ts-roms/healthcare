import { GetObjectCommand, HeadObjectCommand, NotFound, NoSuchKey, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
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
  /**
   * Writes an object the server generated, only if no object exists at the key (never overwrites).
   * Resolves "exists" when one is already there.
   */
  putIfAbsent(key: string, body: Buffer, contentType: string): Promise<"created" | "exists">;
  /** Reads an object's bytes (server side, after an authorization check); undefined when missing. */
  get(key: string): Promise<Buffer | undefined>;
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
      if (error instanceof NotFound || httpStatus(error) === 404) return undefined;
      throw error;
    }
  }

  async putIfAbsent(key: string, body: Buffer, contentType: string): Promise<"created" | "exists"> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          ServerSideEncryption: "AES256",
          // Conditional write: S3 (and MinIO) refuse with 412 when the key exists, so an object is never replaced.
          IfNoneMatch: "*",
        }),
      );
      return "created";
    } catch (error) {
      if (httpStatus(error) === 412) return "exists";
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return undefined;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey || httpStatus(error) === 404) return undefined;
      throw error;
    }
  }
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof S3ServiceException) return error.$metadata.httpStatusCode;
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

/** For tests and local runs without object storage. */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObjectInfo>();
  readonly contents = new Map<string, Buffer>();

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

  async putIfAbsent(key: string, body: Buffer, contentType: string): Promise<"created" | "exists"> {
    if (this.objects.has(key)) return "exists";
    this.objects.set(key, { sizeBytes: body.length, contentType });
    this.contents.set(key, Buffer.from(body));
    return "created";
  }

  async get(key: string): Promise<Buffer | undefined> {
    return this.contents.get(key);
  }

  /** Simulates the client completing the presigned upload; without bytes given, the object is `sizeBytes` zero bytes. */
  put(key: string, info: StoredObjectInfo, body?: Buffer): void {
    this.objects.set(key, info);
    this.contents.set(key, body ? Buffer.from(body) : Buffer.alloc(info.sizeBytes));
  }
}

/** RFC 6266 attachment disposition with a UTF-8 file name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
