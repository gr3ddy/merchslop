export const CATALOG_IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const EMPLOYEE_IMPORT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

export const CATALOG_IMAGE_ALLOWED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
] as const;
export const CATALOG_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const EMPLOYEE_IMPORT_ALLOWED_EXTENSIONS = ['.xlsx'] as const;
export const EMPLOYEE_IMPORT_ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
] as const;
