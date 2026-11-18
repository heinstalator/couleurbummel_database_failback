/**
 * The names of the top-level tables of the database.
 *
 * These mirror `resources/couleurbummel.schema.json` and the fields of `CouleurbummelModel`.
 */
const TABLES = [
  'addresses',
  'cities',
  'colours',
  'colourFamilies',
  'corporations',
  'countries',
  'events',
  'organisations',
  'pointsOfInterest',
] as const;

type Table = (typeof TABLES)[number];

/**
 * The maximum length of a database, in characters.
 *
 * Imported databases are kept in AsyncStorage, which has size limits (6 MB for the whole storage by default on
 * Android), so we refuse anything that is unlikely to fit.
 */
export const MAX_DATABASE_LENGTH = 5_000_000;

export type Database = Partial<Record<Table, Record<string, any>>>;

export type DatabaseError =
  // The input is not valid JSON or isn't a JSON object
  | {error: 'INVALID_JSON'}
  // The database doesn't contain at least one address and at least one corporation
  | {error: 'INCOMPLETE'}
  // An entry has an unexpected shape. `entry` says where, e.g. `corporations/corporation_de_aachen_x`
  | {error: 'INVALID_ENTRY'; entry: string}
  | {error: 'TOO_LARGE'};

export type ParsedDatabase =
  | {ok: true; database: Database; corporations: number}
  | ({ok: false} & DatabaseError);

const isPlainObject = (o: unknown): o is Record<string, any> =>
  typeof o === 'object' && o !== null && !Array.isArray(o);

const isString = (o: unknown): o is string => typeof o === 'string';

const isCoordinate = (o: unknown, limit: number) =>
  typeof o === 'number' && Number.isFinite(o) && Math.abs(o) <= limit;

const hasTables = (o: Record<string, unknown>) =>
  TABLES.some(table => table in o);

/**
 * Checks the properties that the app relies on when it sorts, searches and draws entries.
 *
 * This is deliberately not a full schema validation. It only guards against data that would make the app crash.
 */
const isValidEntry = (table: Table, id: string, entry: unknown) => {
  if (!isPlainObject(entry) || entry.id !== id) {
    return false;
  }

  switch (table) {
    case 'addresses':
      return (
        isCoordinate(entry.latitude, 90) && isCoordinate(entry.longitude, 180)
      );
    case 'corporations':
      return (
        isString(entry.shortName) &&
        isString(entry.addressId) &&
        (entry.colours == null ||
          (Array.isArray(entry.colours) &&
            entry.colours.every(
              (c: unknown) => isPlainObject(c) && Array.isArray(c.colourIds),
            )))
      );
    case 'cities':
    case 'organisations':
      return isString(entry.name);
    default:
      return true;
  }
};

/**
 * Parses and validates the text of a database that the user provided.
 *
 * Besides a database in the format that the app uses, this also accepts one that is wrapped in a single parent key,
 * which is what an export of a path in the Firebase console looks like.
 *
 * @param text - the JSON text
 * @returns the database restricted to the known tables, or the reason why it can't be used
 */
export const parseDatabase = (text: string): ParsedDatabase => {
  if (text.length > MAX_DATABASE_LENGTH) {
    return {ok: false, error: 'TOO_LARGE'};
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {ok: false, error: 'INVALID_JSON'};
  }

  if (!isPlainObject(json)) {
    return {ok: false, error: 'INVALID_JSON'};
  }

  let root: Record<string, any> = json;
  if (!hasTables(root)) {
    const children = Object.values(root);
    if (
      children.length === 1 &&
      isPlainObject(children[0]) &&
      hasTables(children[0])
    ) {
      root = children[0];
    }
  }

  const database: Database = {};

  for (const table of TABLES) {
    const entries = root[table];

    if (entries == null) {
      continue;
    }

    if (!isPlainObject(entries)) {
      return {ok: false, error: 'INVALID_ENTRY', entry: table};
    }

    for (const id of Object.keys(entries)) {
      if (!isValidEntry(table, id, entries[id])) {
        return {ok: false, error: 'INVALID_ENTRY', entry: `${table}/${id}`};
      }
    }

    database[table] = entries;
  }

  const corporations = Object.keys(database.corporations ?? {}).length;
  const addresses = Object.keys(database.addresses ?? {}).length;

  if (corporations === 0 || addresses === 0) {
    return {ok: false, error: 'INCOMPLETE'};
  }

  return {ok: true, database, corporations};
};
