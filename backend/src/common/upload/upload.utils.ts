import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { extname } from 'node:path';

type UploadRules = {
  fileLabel: string;
  maxBytes: number;
  allowedExtensions: readonly string[];
  allowedMimeTypes: readonly string[];
};

type UploadDescriptor = {
  originalname?: string;
  mimetype?: string;
  buffer?: Buffer;
  size?: number;
};

type MinimalUploadCandidate = {
  originalname: string;
  mimetype: string;
};

type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;

export function createUploadMulterOptions(rules: UploadRules): MulterOptions {
  return {
    limits: {
      fileSize: rules.maxBytes,
      files: 1,
    },
    fileFilter: (
      _request: unknown,
      file: MinimalUploadCandidate,
      callback: FileFilterCallback,
    ) => {
      try {
        assertUploadMatchesRules(file, rules, {
          requireBuffer: false,
          requireSize: false,
        });
        callback(null, true);
      } catch (error) {
        callback(error as Error, false);
      }
    },
  };
}

export function assertUploadMatchesRules(
  file: UploadDescriptor | undefined,
  rules: UploadRules,
  options?: {
    requireBuffer?: boolean;
    requireSize?: boolean;
  },
): void {
  if (!file?.originalname) {
    throw new BadRequestException(`${rules.fileLabel} file is required.`);
  }

  if (options?.requireBuffer !== false && !file.buffer?.length) {
    throw new BadRequestException(`${rules.fileLabel} file is empty.`);
  }

  const normalizedMimeType = (file.mimetype ?? '').toLowerCase();
  const normalizedExtension = extname(file.originalname).toLowerCase();
  const hasAllowedMimeType = rules.allowedMimeTypes.includes(normalizedMimeType);
  const hasAllowedExtension = rules.allowedExtensions.includes(normalizedExtension);

  if (!hasAllowedMimeType || !hasAllowedExtension) {
    throw new BadRequestException(
      `Unsupported ${rules.fileLabel.toLowerCase()} format. Allowed extensions: ${rules.allowedExtensions.join(', ')}.`,
    );
  }

  const effectiveSize = file.size ?? file.buffer?.length;

  if (options?.requireSize !== false && effectiveSize !== undefined && effectiveSize > rules.maxBytes) {
    throw new BadRequestException(
      `${rules.fileLabel} file exceeds the ${formatBytes(rules.maxBytes)} limit.`,
    );
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);

  if (Number.isInteger(mb)) {
    return `${mb} MB`;
  }

  return `${mb.toFixed(1)} MB`;
}
