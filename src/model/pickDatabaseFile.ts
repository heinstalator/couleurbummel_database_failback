import {readFile} from '@dr.pogodin/react-native-fs';
import {keepLocalCopy, pick, types} from '@react-native-documents/picker';

import log from '../log';
import {MAX_DATABASE_LENGTH} from './validation';

export type PickResult =
  | {ok: true; text: string; name?: string}
  // The user closed the picker without choosing a file
  | {ok: false; error: 'CANCELLED'}
  | {ok: false; error: 'TOO_LARGE'}
  // `detail` says what went wrong, for people who need to find out why a file can't be read
  | {ok: false; error: 'READ_FAILED'; detail: string};

const isCancellation = (e: unknown) => {
  const {code, message} = (e ?? {}) as {code?: unknown; message?: unknown};
  return /cancel/i.test(`${code ?? ''} ${message ?? ''}`);
};

const describe = (e: unknown) => {
  const {code, message} = (e ?? {}) as {code?: unknown; message?: unknown};
  const text = String(message ?? e);
  return code ? `${String(code)}: ${text}` : text;
};

const readText = async (location: string) => {
  const text = await readFile(location, 'utf8');
  if (!text) {
    throw new Error('the file is empty');
  }
  return text;
};

/** The path of a file:// address, without the scheme and with its special characters decoded */
const toPath = (uri: string) => {
  const path = uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/**
 * Reads the text of a file that the picker returned
 *
 * React Native's own fetch can't read files on the device (it fails with "Network request failed"), so a file system
 * module does it. On Android the picker returns a content:// address, which is a handle on a file that may live in
 * another app. The documented way to get a real file is to keep a local copy, so that is read first, as a path and as an
 * address. If no copy can be made, the original address is read directly. What went wrong is collected, because a phone
 * doesn't tell us otherwise.
 */
const readPickedFile = async (file: {
  uri: string;
  name: string | null;
}): Promise<{text: string} | {problems: string[]}> => {
  const problems: string[] = [];
  const places: [string, string][] = [];

  try {
    const [copy] = await keepLocalCopy({
      files: [{uri: file.uri, fileName: file.name ?? 'database.json'}],
      destination: 'cachesDirectory',
    });
    if (copy.status === 'success') {
      places.push(
        ['local path', toPath(copy.localUri)],
        ['local uri', copy.localUri],
      );
    } else {
      problems.push(`copy: ${copy.copyError}`);
    }
  } catch (e) {
    problems.push(`copy: ${describe(e)}`);
  }
  places.push(['direct', file.uri]);

  for (const [name, location] of places) {
    try {
      return {text: await readText(location)};
    } catch (e) {
      problems.push(`${name}: ${describe(e)}`);
    }
  }

  return {problems};
};

/**
 * Lets the user choose a file on their device and reads it as text
 *
 * Any kind of file can be chosen, because file managers don't agree on how to describe JSON files. What is in the file
 * is checked afterwards, like everything else that is imported.
 */
export const pickDatabaseFile = async (): Promise<PickResult> => {
  let file;
  try {
    [file] = await pick({type: [types.allFiles]});
  } catch (e) {
    if (isCancellation(e)) {
      return {ok: false, error: 'CANCELLED'};
    }
    log.error('Failed to choose a file', e);
    return {ok: false, error: 'READ_FAILED', detail: `picker: ${describe(e)}`};
  }

  // The size is in bytes, which is at least the number of characters. Refuse files that are far too large before
  // reading them; the exact limit is checked when the content is validated.
  if ((file.size ?? 0) > MAX_DATABASE_LENGTH * 3) {
    return {ok: false, error: 'TOO_LARGE'};
  }

  const read = await readPickedFile(file);
  if ('problems' in read) {
    const detail = read.problems.join('; ');
    log.error('Failed to read the chosen file', detail);
    return {ok: false, error: 'READ_FAILED', detail};
  }

  return {ok: true, text: read.text, name: file.name ?? undefined};
};
