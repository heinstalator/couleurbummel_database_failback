import log from '../log';
import {MAX_DATABASE_LENGTH, parseDatabase,ParsedDatabase} from './validation';

const DOWNLOAD_TIMEOUT_MS = 20_000;

export type ImportResult =
  | ParsedDatabase
  // The file couldn't be downloaded
  | {ok: false; error: 'DOWNLOAD_FAILED'}
  // The database was valid, but couldn't be stored on the device
  | {ok: false; error: 'STORAGE_FAILED'};

type ReadResult =
  | {ok: true; text: string}
  | {ok: false; error: 'DOWNLOAD_FAILED' | 'TOO_LARGE'};

/**
 * Whether the input is an address of a web page rather than JSON
 */
export const looksLikeUrl = (input: string) =>
  /^https?:\/\/\S+$/i.test(input.trim());

const download = async (url: string): Promise<ReadResult> => {
  // Plain HTTP is blocked by both platforms by default, and we don't want to load data over an insecure connection.
  if (!/^https:\/\//i.test(url)) {
    log.warn('Refusing to download a database over an insecure connection');
    return {ok: false, error: 'DOWNLOAD_FAILED'};
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      // React Native and the DOM typings each declare their own AbortSignal
      signal: controller.signal as RequestInit['signal'],
      headers: {Accept: 'application/json'},
    });

    if (!response.ok) {
      log.warn(
        `Downloading the database failed with status ${response.status}`,
      );
      return {ok: false, error: 'DOWNLOAD_FAILED'};
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > MAX_DATABASE_LENGTH) {
      return {ok: false, error: 'TOO_LARGE'};
    }

    return {ok: true, text: await response.text()};
  } catch (e) {
    log.error('Failed to download the database', e);
    return {ok: false, error: 'DOWNLOAD_FAILED'};
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Reads a database from what the user entered, which is either JSON or the https address of a JSON file, and validates
 * it.
 *
 * @param input - the text that the user entered
 * @returns the validated database or the reason why it can't be used
 */
export const readDatabase = async (input: string): Promise<ImportResult> => {
  const trimmed = input.trim();

  if (!looksLikeUrl(trimmed)) {
    return parseDatabase(trimmed);
  }

  const downloaded = await download(trimmed);
  return downloaded.ok ? parseDatabase(downloaded.text) : downloaded;
};
