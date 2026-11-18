export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  /** The text of a `#text` node */
  text?: string;
}

export interface Link {
  text: string;
  /** The title that the link shows, which is the full name of an organisation if its abbreviation links to it */
  title: string;
  /** The article that the link leads to */
  target: string;
}

export interface Cell {
  header: boolean;
  text: string;
  links: Link[];
}

export interface ListRecord {
  name: string;
  /** The article of the corporation, if it has one */
  target?: string;
  sitz: string;
  foundation: string;
  colours: string;
  verband?: Cell;
  fencing: string;
  motto: string;
  inactive: boolean;
}

export interface WikipediaClient {
  links(
    title: string,
  ): Promise<{ns: number; title: string; exists?: boolean}[]>;
  html(title: string): Promise<string>;
  coordinates(
    titles: string[],
  ): Promise<Map<string, {latitude: number; longitude: number}>>;
}

export interface ClientOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  /** Where to keep the answers of Wikipedia */
  cacheDir?: string;
  /** Ask again even if there is a kept answer */
  refresh?: boolean;
  wait?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxRetries?: number;
}

export function createClient(options: ClientOptions): WikipediaClient;

export interface ListInfo {
  title: string;
  /** The city of a list of a city; absent for other lists, which have a column for it */
  city?: string;
  country?: string;
}

export interface ImportOptions {
  indexTitle?: string;
  cities?: string[];
  lists?: RegExp;
  limit?: number;
  includeInactive?: boolean;
  includePupil?: boolean;
  /** City (lower case) to country code */
  countries?: Map<string, string>;
  coordinates?: boolean;
  listOnly?: boolean;
}

export interface ImportResult {
  lists: ListInfo[];
  rows: Record<string, any>[];
  organisations: {abbreviation: string; name: string}[];
  warnings: string[];
  report: string;
  stats: {
    lists: number;
    tables: number;
    corporations: number;
    duplicates: number;
    inactive: number;
    pupil: number;
    withCoordinates: number;
  };
}

export function importFromWikipedia(
  client: WikipediaClient,
  options?: ImportOptions,
  log?: (message: string) => void,
): Promise<ImportResult>;

export function main(
  argv: string[],
  io?: {log: (message: string) => void; error: (message: string) => void},
  dependencies?: {client?: WikipediaClient},
): Promise<number>;

export function parseHtml(html: string): HtmlNode;

export function textOf(node: HtmlNode): string;

export function extractTables(
  root: HtmlNode,
): {sections: string[]; grid: Cell[][]}[];

export function parseListPage(html: string): {
  records: ListRecord[];
  left: {inactive: ListRecord[]; pupil: ListRecord[]; tables: number};
};

export function parseFoundation(text: string): string;

export const COLOUR_WORDS: Record<string, string>;

export const APPROXIMATE_COLOUR_WORDS: Record<string, string>;

export function parseColours(text: string): {
  colours: string;
  /** The colours principle: 3 if marked "(f.f.)", 5 if there are colours, 0 if none */
  principle: number;
  approximated: string[];
  unknown: string[];
  annotations: string[];
};

export function parseFencing(text: string): {value: number; known: boolean};

export function parseOrganisations(cell: {text: string; links: Link[]}): {
  abbreviations: string[];
  names: Map<string, string>;
};

export function selectLists(
  links: {ns: number; title: string; exists?: boolean}[],
  options?: {cities?: string[]; lists?: RegExp},
): {title: string; city?: string}[];

export function countryOfCity(
  city: string,
  overrides?: Map<string, string>,
): string;

export function cityOfTitle(title: string): string | undefined;
