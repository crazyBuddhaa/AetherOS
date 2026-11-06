import type { Env, R2Bucket, R2Object, R2ObjectBody, R2Objects } from './types.ts';

/**
 * Cloudflare R2 Storage Service
 * Handles uploading, reading, and removing files in the R2 bucket.
 */
export class R2StorageService {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  /**
   * Upload file to Cloudflare R2
   */
  async uploadFile(
    key: string,
    fileStream: ReadableStream | ArrayBuffer,
    options: {
      contentType: string;
      customMetadata?: Record<string, string>;
    }
  ): Promise<R2Object> {
    const object = await this.bucket.put(key, fileStream, {
      httpMetadata: {
        contentType: options.contentType,
      },
      customMetadata: options.customMetadata,
    });

    return object;
  }

  /**
   * Get file from Cloudflare R2
   */
  async getFile(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(key);
  }

  /**
   * Delete file from Cloudflare R2
   */
  async deleteFile(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  /**
   * List files matching prefix
   */
  async listFiles(prefix?: string, limit = 50): Promise<R2Objects> {
    return this.bucket.list({
      prefix,
      limit,
    });
  }
}

export type { Env };
