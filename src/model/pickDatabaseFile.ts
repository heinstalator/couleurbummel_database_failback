import {pick, types} from '@react-native-documents/picker';

import log from '../log';
import {MAX_DATABASE_LENGTH} from './validation';

export type PickResult =
  | {ok: true; text: string; name?: string}
  // The user closed the picker without choosing a file
  | {ok: false; error: 'CANCELLED'}
  | {ok: false; error: 'TOO_LARGE'}
  | {ok: false; error: 'READ_FAILED'};

const isCancellation = (e: unknown) => {
  const {code, message} = (e ?? {}) as {code?: unknown; message?: unknown};
  return /cancel/i.test(`${code ?? ''} ${message ?? ''}`);
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
    return {ok: false, error: 'READ_FAILED'};
  }

  // The size is in bytes, which is at least the number of characters. Refuse files that are far too large before
  // reading them; the exact limit is checked when the content is validated.
  if ((file.size ?? 0) > MAX_DATABASE_LENGTH * 3) {
    return {ok: false, error: 'TOO_LARGE'};
  }

  try {
    // React Native's fetch can read the content:// addresses that the picker returns on Android
    const response = await fetch(file.uri);
    return {
      ok: true,
      text: await response.text(),
      name: file.name ?? undefined,
    };
  } catch (e) {
    log.error('Failed to read the chosen file', e);
    return {ok: false, error: 'READ_FAILED'};
  }
};
