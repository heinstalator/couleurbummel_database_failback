export interface Sash {
  colourIds: string[];
  baseColourId?: string;
  percussionColourId?: string;
}

export interface GeocodeOptions {
  /** Results of earlier lookups, which are added to; `null` means the address wasn't found */
  cache: Record<string, {latitude: number; longitude: number} | null>;
  /** Identifies the application to the geocoding service, as its usage policy requires */
  userAgent: string;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

export interface BuildResult {
  database: Record<string, Record<string, any>>;
  errors: string[];
  warnings: string[];
  /** Rows that were set aside because they have no coordinates (only with `skipUnlocated`) */
  skipped: {number: number; values: Record<string, string>}[];
  stats: {
    skipped: number;
    corporations: number;
    addresses: number;
    cities: number;
    countries: number;
    organisations: number;
  };
}

export function buildDatabase(options: {
  corporationsCsv: string;
  organisationsCsv?: string;
  geocodeOptions?: GeocodeOptions;
  skipUnlocated?: boolean;
}): Promise<BuildResult>;

export function stringifyCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): string;

export const CORPORATION_COLUMNS: string[];

export function main(
  argv: string[],
  io?: {log: (message: string) => void; error: (message: string) => void},
): Promise<number>;

export function parseCsv(text: string): string[][];

export function readTable(
  text: string,
  knownColumns: string[],
): {
  columns: string[];
  unknownColumns: string[];
  rows: {number: number; values: Record<string, string>}[];
};

export function resolveColour(name: string): string;

export function parseSashes(value: string): Sash[];

export const FAMILIES: string[];

export const COLOURS: [string, string, string][];
