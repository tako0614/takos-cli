import { basename } from "node:path";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { Buffer } from "node:buffer";

export const API_REQUEST_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const API_REQUEST_FORM_FILES_TOTAL_MAX_BYTES = 25 * 1024 * 1024;

export function parseKeyValue(value: string): { key: string; value: string } {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(`Invalid key=value option: ${value}`);
  }

  const key = value.slice(0, separatorIndex).trim();
  const parsedValue = value.slice(separatorIndex + 1);
  if (!key) {
    throw new Error(`Invalid key=value option: ${value}`);
  }

  return { key, value: parsedValue };
}

export type BodyPreparation = {
  body: unknown;
  contentType: string | null;
};

type BodyOptions = {
  body?: string;
  bodyFile?: string;
  rawBody?: string;
  rawBodyFile?: string;
  form?: string[];
  formFile?: string[];
  contentType?: string;
  fileMaxBytes?: number;
  formFileTotalMaxBytes?: number;
};

function formatBytes(bytes: number): string {
  const mib = 1024 * 1024;
  const kib = 1024;
  if (bytes >= mib && bytes % mib === 0) {
    return `${bytes / mib} MiB`;
  }
  if (bytes >= kib && bytes % kib === 0) {
    return `${bytes / kib} KiB`;
  }
  return `${bytes} bytes`;
}

function readLimitedFile(
  path: string,
  optionName: string,
  maxBytes: number,
): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      throw new Error(`${optionName} must point to a regular file: ${path}`);
    }
    if (stats.size > maxBytes) {
      throw new Error(
        `${optionName} exceeds the ${formatBytes(maxBytes)} limit: ${path} ` +
          `is ${formatBytes(stats.size)}`,
      );
    }

    const buffer = Buffer.allocUnsafe(stats.size);
    let bytesRead = 0;
    while (bytesRead < stats.size) {
      const read = readSync(
        fd,
        buffer,
        bytesRead,
        stats.size - bytesRead,
        bytesRead,
      );
      if (read === 0) break;
      bytesRead += read;
    }
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`${optionName} `)
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${optionName} ${path}: ${message}`);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors; read/open errors above are more actionable.
      }
    }
  }
}

function readLimitedTextFile(
  path: string,
  optionName: string,
  maxBytes: number,
): string {
  return readLimitedFile(path, optionName, maxBytes).toString("utf8");
}

function parseFormFilePair(pair: string): { key: string; path: string } {
  try {
    const { key, value } = parseKeyValue(pair);
    if (!value.trim()) {
      throw new Error("missing file path");
    }
    return { key, path: value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid --form-file value "${pair}": expected key=path (${message})`,
    );
  }
}

function prepareJsonBody(options: BodyOptions): BodyPreparation {
  if (options.body === undefined && !options.bodyFile) {
    throw new Error("Either --body or --body-file is required for JSON mode");
  }
  const maxBytes = options.fileMaxBytes ?? API_REQUEST_FILE_MAX_BYTES;
  const raw = options.body !== undefined
    ? options.body
    : readLimitedTextFile(options.bodyFile as string, "--body-file", maxBytes);
  try {
    const parsed = JSON.parse(raw);
    return {
      body: JSON.stringify(parsed),
      contentType: "application/json",
    };
  } catch (error) {
    throw new Error(`Invalid JSON body: ${String(error)}`);
  }
}

function prepareRawBody(options: BodyOptions): BodyPreparation {
  if (options.rawBody !== undefined) {
    return {
      body: options.rawBody,
      contentType: options.contentType ?? "text/plain; charset=utf-8",
    };
  }

  if (!options.rawBodyFile) {
    throw new Error(
      "Either --raw-body or --raw-body-file is required for raw mode",
    );
  }
  const buffer = readLimitedFile(
    options.rawBodyFile,
    "--raw-body-file",
    options.fileMaxBytes ?? API_REQUEST_FILE_MAX_BYTES,
  );
  return {
    body: buffer,
    contentType: options.contentType ?? "application/octet-stream",
  };
}

function prepareFormBody(options: BodyOptions): BodyPreparation {
  const formData = new FormData();
  const maxFileBytes = options.fileMaxBytes ?? API_REQUEST_FILE_MAX_BYTES;
  const maxTotalBytes = options.formFileTotalMaxBytes ??
    API_REQUEST_FORM_FILES_TOTAL_MAX_BYTES;
  let totalFileBytes = 0;

  for (const pair of options.form ?? []) {
    const { key, value } = parseKeyValue(pair);
    formData.append(key, value);
  }

  for (const pair of options.formFile ?? []) {
    const { key, path } = parseFormFilePair(pair);
    const fileContent = readLimitedFile(path, "--form-file", maxFileBytes);
    totalFileBytes += fileContent.byteLength;
    if (totalFileBytes > maxTotalBytes) {
      throw new Error(
        `--form-file files exceed the ${formatBytes(maxTotalBytes)} ` +
          `combined limit`,
      );
    }
    const blobBytes = new Uint8Array(fileContent.byteLength);
    blobBytes.set(fileContent);
    formData.append(key, new Blob([blobBytes]), basename(path));
  }

  return {
    body: formData,
    contentType: null,
  };
}

export function prepareBody(options: BodyOptions): BodyPreparation {
  const hasJsonInline = options.body !== undefined;
  const hasJsonFile = options.bodyFile !== undefined;
  const hasRawInline = options.rawBody !== undefined;
  const hasRawFile = options.rawBodyFile !== undefined;
  const hasForm = (options.form?.length ?? 0) > 0 ||
    (options.formFile?.length ?? 0) > 0;

  const jsonMode = hasJsonInline || hasJsonFile;
  const rawMode = hasRawInline || hasRawFile;

  const activeModes = [jsonMode, rawMode, hasForm].filter(Boolean).length;
  if (activeModes > 1) {
    throw new Error(
      "Only one body mode can be used at a time (json, raw, or form)",
    );
  }

  if (jsonMode) {
    return prepareJsonBody(options);
  }

  if (rawMode) {
    return prepareRawBody(options);
  }

  if (hasForm) {
    return prepareFormBody(options);
  }

  return {
    body: undefined,
    contentType: null,
  };
}
