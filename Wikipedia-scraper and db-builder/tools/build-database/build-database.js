#!/usr/bin/env node
'use strict';

/**
 * Builds a Couleurbummel database from spreadsheets.
 *
 * Reads a CSV file with one corporation per row (and optionally one with organisations) and writes a JSON database in
 * the format described by resources/couleurbummel.schema.json. The result can be imported in the app's settings.
 *
 * Run `node tools/build-database/build-database.js --help` for usage. It has no dependencies other than Node.js 18+.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------------------------------------------------

// The colour families. The app translates their names with the keys COLOUR_FAMILY_<NAME>.
const FAMILIES = [
  'black',
  'blue',
  'brown',
  'gold',
  'green',
  'grey',
  'orange',
  'pink',
  'purple',
  'red',
  'silver',
  'white',
  'yellow',
];

// The colours that corporations can wear: [name, family, value]
const COLOURS = [
  ['black', 'black', 'rgba(0, 0, 0, 1.0)'],
  ['white', 'white', 'rgba(255, 255, 255, 1.0)'],
  ['blue', 'blue', 'rgba(0, 0, 205, 1.0)'],
  ['blue_dark', 'blue', 'rgba(0, 0, 139, 1.0)'],
  ['blue_light', 'blue', 'rgba(0, 150, 255, 1.0)'],
  ['green', 'green', 'rgba(0, 100, 0, 1.0)'],
  ['green_dark', 'green', 'rgba(0, 60, 0, 1.0)'],
  ['green_light', 'green', 'rgba(144, 238, 144, 1.0)'],
  ['green_moss', 'green', 'rgba(179, 238, 58, 1.0)'],
  ['red', 'red', 'rgba(150, 0, 0, 1.0)'],
  ['red_dark', 'red', 'rgba(100, 0, 0, 1.0)'],
  ['red_bordeaux', 'red', 'rgba(110, 0, 30, 1.0)'],
  ['red_crimson', 'red', 'rgba(170, 58, 98, 1.0)'],
  ['red_wine', 'red', 'rgba(114, 47, 55, 1.0)'],
  ['orange', 'orange', 'rgba(238, 118, 33, 1.0)'],
  ['yellow', 'yellow', 'rgba(255, 235, 0, 1.0)'],
  ['gold', 'gold', 'rgba(255, 215, 0, 1.0)'],
  ['silver', 'silver', 'rgba(192, 192, 192, 1.0)'],
  ['grey', 'grey', 'rgba(128, 128, 128, 1.0)'],
  ['grey_light', 'grey', 'rgba(211, 211, 211, 1.0)'],
  ['pink', 'pink', 'rgba(255, 130, 171, 1.0)'],
  ['purple', 'purple', 'rgba(128, 0, 128, 1.0)'],
  ['brown', 'brown', 'rgba(139, 69, 19, 1.0)'],
];

// The colours of the map pins, one per family. IDs are ind_<family>.
const INDICATOR_COLOURS = {
  black: 'rgba(51, 51, 51, 1.0)',
  blue: 'rgba(51, 102, 204, 1.0)',
  brown: 'rgba(139, 69, 19, 1.0)',
  gold: 'rgba(255, 215, 0, 1.0)',
  green: 'rgba(51, 153, 51, 1.0)',
  grey: 'rgba(204, 204, 204, 1.0)',
  orange: 'rgba(238, 118, 33, 1.0)',
  pink: 'rgba(255, 130, 171, 1.0)',
  purple: 'rgba(128, 0, 128, 1.0)',
  red: 'rgba(204, 51, 51, 1.0)',
  silver: 'rgba(192, 192, 192, 1.0)',
  white: 'rgba(255, 255, 255, 1.0)',
  yellow: 'rgba(255, 255, 0, 1.0)',
};

// The pin colour of corporations that don't belong to an organisation with a pin colour
const DEFAULT_INDICATOR = 'ind_grey';

// German words that can be used instead of the English names of colours
const COLOUR_ALIASES = {
  schwarz: 'black',
  weiss: 'white',
  blau: 'blue',
  gruen: 'green',
  rot: 'red',
  gelb: 'yellow',
  silber: 'silver',
  grau: 'grey',
  gray: 'grey',
  rosa: 'pink',
  violett: 'purple',
  lila: 'purple',
  braun: 'brown',
  dunkel: 'dark',
  hell: 'light',
  moos: 'moss',
};

// Words that can be used instead of the numbers of the principles (see the schema)
const COLOURS_PRINCIPLES = {
  unknown: 0,
  unbekannt: 0,
  none: 1,
  needle: 2,
  not_wearing: 3,
  optional: 4,
  fakultativ: 4,
  mandatory: 5,
};

const FENCING_PRINCIPLES = {
  unknown: 0,
  unbekannt: 0,
  no: 1,
  nichtschlagend: 1,
  optional: 2,
  fakultativ: 2,
  training: 3,
  mandatory: 4,
  pflichtschlagend: 4,
};

// How the countries are written in postal addresses, if differently from their ISO code
const POSTAL_PREFIXES = {DE: 'D', AT: 'A', LI: 'FL'};

// Country names that can be used instead of the ISO code
const COUNTRY_ALIASES = {
  deutschland: 'DE',
  germany: 'DE',
  oesterreich: 'AT',
  austria: 'AT',
  schweiz: 'CH',
  switzerland: 'CH',
  liechtenstein: 'LI',
};

const CORPORATION_COLUMNS = [
  'id',
  'shortName',
  'longName',
  'street',
  'postalCode',
  'city',
  'country',
  'latitude',
  'longitude',
  'addressName',
  'organisations',
  'indicatorColour',
  'coloursPrinciple',
  'fencingPrinciple',
  'foundationDate',
  'motto',
  'jourFixe',
  'mail',
  'phone',
  'website',
  'remark',
  'postalAddress',
  'colours',
  'hidden',
];

const ORGANISATION_COLUMNS = ['abbreviation', 'name', 'indicatorColour'];

// ---------------------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Finds out which character separates the fields. Spreadsheets in German locales export semicolons.
 */
function detectDelimiter(text) {
  const counts = {',': 0, ';': 0, '\t': 0};
  let inQuotes = false;

  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === '\n' || char === '\r') {
        break;
      }
      if (char in counts) {
        counts[char]++;
      }
    }
  }

  return Object.keys(counts).reduce((best, c) =>
    counts[c] > counts[best] ? c : best,
  );
}

/**
 * Splits CSV text into records of fields. Handles quoted fields with delimiters, quotes and line breaks.
 */
function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === '\r') {
      if (text[i + 1] === '\n') {
        i++;
      }
      endRecord();
    } else if (char === '\n') {
      endRecord();
    } else {
      field += char;
    }
  }

  if (field !== '' || record.length > 0) {
    endRecord();
  }

  return records;
}

/**
 * Reads a CSV table whose first row contains the names of the columns.
 *
 * Column names are matched case-insensitively. Rows are numbered like in a spreadsheet, so the header is row 1.
 *
 * @returns the canonical column names that were found, those that are unknown, and the rows as objects
 */
function readTable(text, knownColumns) {
  const records = parseCsv(text);
  const lookup = new Map(knownColumns.map(c => [c.toLowerCase(), c]));
  const headerIndex = records.findIndex(r => r.some(f => f.trim() !== ''));

  if (headerIndex === -1) {
    return {columns: [], unknownColumns: [], rows: []};
  }

  const header = records[headerIndex].map(h => h.trim());
  const columns = header.map(h => lookup.get(h.toLowerCase()));
  const unknownColumns = header.filter((h, i) => h !== '' && !columns[i]);

  const rows = [];
  for (let i = headerIndex + 1; i < records.length; i++) {
    const values = records[i];
    if (values.every(f => f.trim() === '')) {
      continue;
    }

    const row = {};
    columns.forEach((column, j) => {
      if (column) {
        row[column] = (values[j] ?? '').trim();
      }
    });
    rows.push({number: i + 1, values: row});
  }

  return {
    columns: columns.filter(Boolean),
    unknownColumns,
    rows,
  };
}

/**
 * Writes records as CSV text with the given columns, quoting fields where needed
 */
function stringifyCsv(columns, rows) {
  const escape = value => {
    const text = String(value ?? '');
    return /[",;\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return `${[columns, ...rows.map(r => columns.map(c => r[c] ?? ''))]
    .map(fields => fields.map(escape).join(','))
    .join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing of values
// ---------------------------------------------------------------------------------------------------------------------

/** Replaces umlauts and eszett so that words can be compared and used in IDs regardless of how they're typed */
function transliterate(s) {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue');
}

/** Turns a name into something that can be part of an ID. Unlike the transliteration, it keeps umlauts. */
function slug(s) {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}

function parseList(value) {
  return value
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  const v = value.trim().toLowerCase();
  if (['true', 'yes', 'ja', '1', 'x'].includes(v)) {
    return true;
  }
  if (['false', 'no', 'nein', '0', ''].includes(v)) {
    return false;
  }
  throw new Error(`"${value}" is not yes or no`);
}

/** Accepts 50.77 as well as 50,77, which is how spreadsheets in German locales write decimals */
function parseCoordinate(value, name, limit) {
  const normalised = value.includes('.') ? value : value.replace(',', '.');
  const n = Number(normalised);
  if (normalised === '' || !Number.isFinite(n) || Math.abs(n) > limit) {
    throw new Error(
      `${name} "${value}" is not a number between -${limit} and ${limit}`,
    );
  }
  return n;
}

function parsePrinciple(value, words, max, name) {
  if (value === '') {
    return 0;
  }

  if (/^\d+$/.test(value)) {
    const n = Number(value);
    if (n <= max) {
      return n;
    }
  } else {
    const n = words[transliterate(value).replace(/[\s-]+/g, '_')];
    if (n !== undefined) {
      return n;
    }
  }

  const known = Object.keys(words).join(', ');
  throw new Error(
    `${name} "${value}" must be a number from 0 to ${max} or one of: ${known}`,
  );
}

/** Accepts yyyy, yyyy-MM-dd and dd.MM.yyyy */
function parseFoundationDate(value) {
  if (value === '') {
    return undefined;
  }
  if (/^\d{4}$/.test(value)) {
    return value;
  }

  let year;
  let month;
  let day;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    [, year, month, day] = match;
  } else if ((match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value))) {
    [, day, month, year] = match;
  }

  const m = Number(month);
  const d = Number(day);
  if (!match || m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error(
      `foundationDate "${value}" must be a year (1910), a date (1910-05-23) or a German date (23.05.1910)`,
    );
  }

  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseCountry(value) {
  const alias = COUNTRY_ALIASES[transliterate(value)];
  const code = alias ?? value.toUpperCase();

  if (!/^[A-Z]{2,3}$/.test(code)) {
    throw new Error(
      `country "${value}" must be an ISO 3166 code such as DE, AT or CH`,
    );
  }

  return code;
}

/** Turns "dunkelgruen", "Green dark", "blue_light" etc. into a colour ID, or throws if the colour doesn't exist */
function resolveColour(name) {
  const parts = transliterate(name.trim())
    .replace(/^colour_/, '')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(p => COLOUR_ALIASES[p] ?? p);
  const candidates = [parts, [...parts].reverse()].map(
    p => `colour_${p.join('_')}`,
  );
  const id = candidates.find(c => COLOURS.some(([n]) => `colour_${n}` === c));

  if (!id) {
    const known = COLOURS.map(([n]) => n).join(', ');
    throw new Error(`Unknown colour "${name}". Known colours: ${known}`);
  }

  return id;
}

/** Turns a colour family or a pin colour ("green", "ind_green") into the ID of a pin colour */
function resolveIndicator(name) {
  const family = transliterate(name.trim()).replace(/^ind_/, '');
  const resolved = COLOUR_ALIASES[family] ?? family;

  if (!(resolved in INDICATOR_COLOURS)) {
    throw new Error(
      `Unknown pin colour "${name}". Known pin colours: ${Object.keys(
        INDICATOR_COLOURS,
      ).join(', ')}`,
    );
  }

  return `ind_${resolved}`;
}

/**
 * Parses sashes, which are separated by |. Colours are listed from top to bottom, separated by -. A base colour can be
 * appended with @ and a percussion with +, for example: white-green-orange@black+gold
 */
function parseSashes(value) {
  return parseList(value).map(text => {
    const match = /^([^@+]+)(?:@([^@+]+))?(?:\+([^@+]+))?$/.exec(text);
    if (!match) {
      throw new Error(
        `Couldn't read the colours "${text}". Use the form colour-colour-colour@base+percussion`,
      );
    }

    const [, stripes, base, percussion] = match;
    const sash = {colourIds: stripes.split('-').map(resolveColour)};
    if (base) {
      sash.baseColourId = resolveColour(base);
    }
    if (percussion) {
      sash.percussionColourId = resolveColour(percussion);
    }
    return sash;
  });
}

function postalLines({street, postalCode, city, country}) {
  const prefix = POSTAL_PREFIXES[country] ?? country;
  return [street, postalCode ? `${prefix}-${postalCode}` : '', city]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------------------------------------------------

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// The usage policy of the service allows one request per second
const GEOCODING_DELAY_MS = 1100;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Looks up the coordinates of an address with OpenStreetMap's Nominatim service.
 *
 * Results are stored in `cache`, so addresses are only ever looked up once.
 *
 * @returns the coordinates, or undefined if the address wasn't found
 */
async function geocode(address, {cache, fetchImpl, userAgent, wait}) {
  const query = [
    address.street,
    `${address.postalCode} ${address.city}`.trim(),
    address.country,
  ]
    .filter(Boolean)
    .join(', ');

  if (query in cache) {
    return cache[query] ?? undefined;
  }

  await wait(GEOCODING_DELAY_MS);

  const params = new URLSearchParams({format: 'jsonv2', limit: '1', q: query});
  if (address.country.length === 2) {
    params.set('countrycodes', address.country.toLowerCase());
  }

  const response = await fetchImpl(`${NOMINATIM_URL}?${params}`, {
    headers: {'User-Agent': userAgent, Accept: 'application/json'},
  });
  if (!response.ok) {
    throw new Error(
      `The geocoding service answered with status ${response.status}`,
    );
  }

  const [hit] = await response.json();
  const latitude = hit ? Number(hit.lat) : NaN;
  const longitude = hit ? Number(hit.lon) : NaN;
  const result =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? {latitude, longitude}
      : null;

  cache[query] = result;
  return result ?? undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Building the database
// ---------------------------------------------------------------------------------------------------------------------

function countryName(code) {
  try {
    return new Intl.DisplayNames(['de'], {type: 'region'}).of(code);
  } catch {
    return undefined;
  }
}

function sortedObject(entries) {
  return Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function buildColours(usedBy) {
  const colours = {};
  const families = {};

  for (const family of FAMILIES) {
    families[`colour_family_${family}`] = {
      id: `colour_family_${family}`,
      memberColourIds: [],
      translationKey: `COLOUR_FAMILY_${family.toUpperCase()}`,
      sampleColourValue: family,
    };
  }

  const add = (id, name, family, value) => {
    colours[id] = {
      id,
      colourFamilyIds: [`colour_family_${family}`],
      translationKey: `COLOUR_${name.toUpperCase()}`,
      colourValue: value,
      inColours: [...(usedBy.get(id) ?? [])].sort(),
    };
    families[`colour_family_${family}`].memberColourIds.push(id);
  };

  for (const [name, family, value] of COLOURS) {
    add(`colour_${name}`, name, family, value);
  }
  for (const [family, value] of Object.entries(INDICATOR_COLOURS)) {
    add(`ind_${family}`, `ind_${family}`, family, value);
  }

  return {
    colours: sortedObject(colours),
    colourFamilies: sortedObject(families),
  };
}

/**
 * Builds a database from the contents of the CSV files.
 *
 * @param corporationsCsv - the text of the corporations CSV
 * @param organisationsCsv - the text of the organisations CSV, if any
 * @param geocodeOptions - to look up coordinates that are missing: `{cache, userAgent, fetchImpl?, wait?}`
 * @param skipUnlocated - set rows aside instead of failing if they have no coordinates and none can be looked up
 * @returns the database, which is only complete if there are no errors, and the errors and warnings, each saying
 * which row they refer to
 */
async function buildDatabase({
  corporationsCsv,
  organisationsCsv,
  geocodeOptions,
  skipUnlocated = false,
}) {
  const errors = [];
  const warnings = [];
  const skipped = []; // rows that were set aside because there is no way to place them on the map

  // Organisations ----------------------------------------------------------------------------------------------------

  const organisations = new Map();

  if (organisationsCsv !== undefined) {
    const orgTable = readTable(organisationsCsv, ORGANISATION_COLUMNS);
    for (const column of orgTable.unknownColumns) {
      warnings.push(`Organisations: ignoring the unknown column "${column}"`);
    }
    for (const required of ['abbreviation', 'name']) {
      if (orgTable.rows.length > 0 && !orgTable.columns.includes(required)) {
        errors.push(`Organisations: the column "${required}" is missing`);
      }
    }

    for (const {number, values} of orgTable.rows) {
      const fail = message =>
        errors.push(`Organisations, row ${number}: ${message}`);
      const abbreviation = values.abbreviation;
      if (!abbreviation || !values.name) {
        fail('abbreviation and name are required');
        continue;
      }
      if (organisations.has(abbreviation.toLowerCase())) {
        fail(`"${abbreviation}" appears twice`);
        continue;
      }

      const organisation = {
        id: `organisation_${slug(abbreviation)}`,
        abbreviation,
        name: values.name,
        mapDisplayableIds: [],
      };
      if (values.indicatorColour) {
        try {
          organisation.indicatorColourId = resolveIndicator(
            values.indicatorColour,
          );
        } catch (e) {
          fail(e.message);
        }
      }
      organisations.set(abbreviation.toLowerCase(), organisation);
    }
  }

  // Corporations -----------------------------------------------------------------------------------------------------

  const table = readTable(corporationsCsv, CORPORATION_COLUMNS);
  for (const column of table.unknownColumns) {
    warnings.push(
      `Corporations: ignoring the unknown column "${column}" (check the spelling)`,
    );
  }
  for (const required of ['shortName', 'city', 'country']) {
    if (table.rows.length > 0 && !table.columns.includes(required)) {
      errors.push(`Corporations: the column "${required}" is missing`);
    }
  }
  if (table.rows.length === 0 && errors.length === 0) {
    errors.push('Corporations: the file contains no rows');
  }

  const corporations = {};
  const addresses = new Map(); // key -> address
  const cities = new Map();
  const countries = new Map();
  const usedBy = new Map(); // colour ID -> set of corporation IDs
  const addressCounters = new Map();

  const hasErrorsInTable = () =>
    errors.some(e => e.startsWith('Corporations:'));

  if (!hasErrorsInTable()) {
    for (const {number, values} of table.rows) {
      const label = `Corporations, row ${number}${
        values.shortName ? ` (${values.shortName})` : ''
      }`;
      const rowErrors = [];
      const attempt = (fn, fallback) => {
        try {
          return fn();
        } catch (e) {
          rowErrors.push(e.message);
          return fallback;
        }
      };

      for (const required of ['shortName', 'city', 'country']) {
        if (!values[required]) {
          rowErrors.push(`${required} is required`);
        }
      }

      const country = values.country
        ? attempt(() => parseCountry(values.country))
        : undefined;
      const coloursPrinciple = attempt(
        () =>
          parsePrinciple(
            values.coloursPrinciple ?? '',
            COLOURS_PRINCIPLES,
            5,
            'coloursPrinciple',
          ),
        0,
      );
      const fencingPrinciple = attempt(
        () =>
          parsePrinciple(
            values.fencingPrinciple ?? '',
            FENCING_PRINCIPLES,
            4,
            'fencingPrinciple',
          ),
        0,
      );
      const foundationDate = attempt(() =>
        parseFoundationDate(values.foundationDate ?? ''),
      );
      const hidden = attempt(() => parseBoolean(values.hidden ?? ''), false);
      const sashes = attempt(() => parseSashes(values.colours ?? ''), []);
      const indicatorColourId = values.indicatorColour
        ? attempt(() => resolveIndicator(values.indicatorColour))
        : undefined;

      const hasLatitude = (values.latitude ?? '') !== '';
      const hasLongitude = (values.longitude ?? '') !== '';
      let latitude;
      let longitude;
      if (hasLatitude !== hasLongitude) {
        rowErrors.push(
          'latitude and longitude must either both be filled in or both be empty',
        );
      } else if (hasLatitude) {
        latitude = attempt(() =>
          parseCoordinate(values.latitude, 'latitude', 90),
        );
        longitude = attempt(() =>
          parseCoordinate(values.longitude, 'longitude', 180),
        );
      }

      if (rowErrors.length > 0 || !country) {
        errors.push(...rowErrors.map(m => `${label}: ${m}`));
        continue;
      }

      // A row can be placed on the map if it has coordinates, shares an address that has them, or can be looked up.
      // Looking up needs a street: without one, we'd get the middle of the town rather than the house.
      if (skipUnlocated && latitude === undefined) {
        const street = values.street ?? '';
        const shared = addresses.get(
          [
            `city_${country.toLowerCase()}_${slug(values.city)}`,
            transliterate(street) || `row ${number}`,
            values.postalCode ?? '',
          ].join('\n'),
        );
        if (shared?.latitude === undefined && !(geocodeOptions && street)) {
          skipped.push({number, values});
          continue;
        }
      }

      const id =
        values.id ||
        `corporation_${country.toLowerCase()}_${slug(values.city)}_${slug(
          values.shortName,
        )}`;
      if (id in corporations) {
        errors.push(
          `${label}: the ID "${id}" is already used by another row. Fill in the id column to tell them apart.`,
        );
        continue;
      }

      // Country and city
      const countryId = `country_${country.toLowerCase()}`;
      if (!countries.has(countryId)) {
        const name = countryName(country);
        countries.set(countryId, {
          id: countryId,
          isoCode: country.toLowerCase(),
          translationKey: `COUNTRY_${country}`,
          ...(name && name !== country ? {name} : {}),
          cityIds: [],
        });
      }

      const cityId = `city_${country.toLowerCase()}_${slug(values.city)}`;
      if (!cities.has(cityId)) {
        cities.set(cityId, {
          id: cityId,
          name: values.city,
          translationKey: `LOC_CITY_${slug(values.city).toUpperCase()}`,
          countryId,
          addressIds: [],
        });
        countries.get(countryId).cityIds.push(cityId);
      }

      // Address. Corporations at the same address share it.
      const addressParts = {
        street: values.street ?? '',
        postalCode: values.postalCode ?? '',
        city: values.city,
        country,
      };
      // Without a street we can't tell whether two rows are at the same address, so they each get their own
      const addressKey = [
        cityId,
        transliterate(addressParts.street) || `row ${number}`,
        addressParts.postalCode,
      ].join('\n');

      let address = addresses.get(addressKey);
      if (!address) {
        const index = addressCounters.get(cityId) ?? 0;
        addressCounters.set(cityId, index + 1);

        address = {
          id: `address_${slug(values.city)}_${index}`,
          ...(values.addressName ? {name: values.addressName} : {}),
          fullAddress: postalLines(addressParts),
          cityIds: [cityId],
          corporationIds: [],
        };
        addresses.set(addressKey, address);
        cities.get(cityId).addressIds.push(address.id);
        address.parts = addressParts;
        address.rows = [];
      }

      if (latitude !== undefined) {
        if (address.latitude === undefined) {
          address.latitude = latitude;
          address.longitude = longitude;
        } else if (
          address.latitude !== latitude ||
          address.longitude !== longitude
        ) {
          warnings.push(
            `${label}: has other coordinates than the corporation before it at the same address. The first ones are used.`,
          );
        }
      }
      address.rows.push(label);
      address.corporationIds.push(id);

      // Organisations
      const organisationIds = [];
      let pinFromOrganisation;
      for (const abbreviation of parseList(values.organisations ?? '')) {
        let organisation = organisations.get(abbreviation.toLowerCase());
        if (!organisation) {
          warnings.push(
            `${label}: the organisation "${abbreviation}" isn't defined in the organisations file, so its name is set to the abbreviation`,
          );
          organisation = {
            id: `organisation_${slug(abbreviation)}`,
            abbreviation,
            name: abbreviation,
            mapDisplayableIds: [],
          };
          organisations.set(abbreviation.toLowerCase(), organisation);
        }
        if (!organisationIds.includes(organisation.id)) {
          organisationIds.push(organisation.id);
          organisation.mapDisplayableIds.push(id);
          pinFromOrganisation ??= organisation.indicatorColourId;
        }
      }

      const corporation = {
        id,
        shortName: values.shortName,
        longName: values.longName || values.shortName,
        addressId: address.id,
        coloursPrinciple,
        fencingPrinciple,
        ...(foundationDate ? {foundationDate} : {}),
        ...(values.motto ? {motto: values.motto} : {}),
        ...(values.jourFixe ? {jourFixe: values.jourFixe} : {}),
        ...(values.mail ? {mail: values.mail} : {}),
        ...(values.phone ? {phone: values.phone} : {}),
        ...(values.website ? {website: values.website} : {}),
        ...(values.remark ? {remark: values.remark} : {}),
        ...(values.postalAddress ? {postalAddress: values.postalAddress} : {}),
        ...(organisationIds.length > 0 ? {organisationIds} : {}),
        indicatorColourId:
          indicatorColourId ?? pinFromOrganisation ?? DEFAULT_INDICATOR,
        ...(sashes.length > 0 ? {colours: sashes} : {}),
        ...(hidden ? {hidden: true} : {}),
      };
      corporations[id] = corporation;

      for (const sash of sashes) {
        for (const colourId of [
          ...sash.colourIds,
          sash.baseColourId,
          sash.percussionColourId,
        ]) {
          if (colourId) {
            if (!usedBy.has(colourId)) {
              usedBy.set(colourId, new Set());
            }
            usedBy.get(colourId).add(id);
          }
        }
      }
    }
  }

  // Coordinates ------------------------------------------------------------------------------------------------------

  for (const address of addresses.values()) {
    if (address.latitude !== undefined) {
      continue;
    }

    const where = address.rows.join(', ');
    if (!geocodeOptions) {
      errors.push(
        `${where}: no coordinates. Fill in latitude and longitude, or run the tool with --geocode.`,
      );
      continue;
    }
    if (!address.parts.street) {
      errors.push(
        `${where}: no coordinates, and without a street they can't be looked up. Fill in latitude and longitude.`,
      );
      continue;
    }

    try {
      const found = await geocode(address.parts, {
        cache: geocodeOptions.cache,
        fetchImpl: geocodeOptions.fetchImpl ?? fetch,
        userAgent: geocodeOptions.userAgent,
        wait: geocodeOptions.wait ?? sleep,
      });
      if (found) {
        address.latitude = found.latitude;
        address.longitude = found.longitude;
      } else {
        errors.push(
          `${where}: the address "${address.fullAddress.replace(
            /\n/g,
            ', ',
          )}" wasn't found. Enter latitude and longitude yourself.`,
        );
      }
    } catch (e) {
      errors.push(`${where}: looking up the coordinates failed: ${e.message}`);
    }
  }

  // Assemble ---------------------------------------------------------------------------------------------------------

  const addressTable = {};
  for (const address of addresses.values()) {
    addressTable[address.id] = {
      id: address.id,
      ...(address.name ? {name: address.name} : {}),
      latitude: address.latitude,
      longitude: address.longitude,
      fullAddress: address.fullAddress,
      cityIds: address.cityIds,
      corporationIds: address.corporationIds,
    };
  }

  const organisationTable = {};
  for (const organisation of organisations.values()) {
    organisationTable[organisation.id] = organisation;
  }

  const cityTable = {};
  for (const city of cities.values()) {
    cityTable[city.id] = city;
  }

  const countryTable = {};
  for (const country of countries.values()) {
    countryTable[country.id] = country;
  }

  if (
    skipped.length > 0 &&
    Object.keys(corporations).length === 0 &&
    errors.length === 0
  ) {
    errors.push(
      `Corporations: none of the ${skipped.length} corporations has coordinates, so there is nothing to put on the map`,
    );
  }

  const database = {
    addresses: sortedObject(addressTable),
    cities: sortedObject(cityTable),
    ...buildColours(usedBy),
    corporations: sortedObject(corporations),
    countries: sortedObject(countryTable),
    organisations: sortedObject(organisationTable),
  };

  return {
    database,
    errors,
    warnings,
    skipped,
    stats: {
      corporations: Object.keys(corporations).length,
      skipped: skipped.length,
      addresses: Object.keys(addressTable).length,
      cities: Object.keys(cityTable).length,
      countries: Object.keys(countryTable).length,
      organisations: Object.keys(organisationTable).length,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------

const USAGE = `Builds a Couleurbummel database from CSV files.

Usage:
  node tools/build-database/build-database.js <corporations.csv> [options]

Options:
  --organisations <file>  CSV file with the organisations (abbreviation, name, indicatorColour)
  --out <file>            Where to write the database (default: database.json)
  --geocode               Look up missing coordinates with OpenStreetMap's Nominatim service
  --skip-unlocated        Leave out corporations that have no coordinates (and can't be looked up) instead of failing
  --skipped-out <file>    Where to write the corporations left out by --skip-unlocated, as CSV you can complete
  --contact <email>       Your contact address, which the service requires when you use --geocode
  --cache <file>          Where to remember geocoding results (default: <corporations.csv>.geocode-cache.json)
  --minify                Write the JSON on a single line
  --help                  Show this text

See tools/build-database/README.md for the columns of the files.`;

function parseArguments(argv) {
  const options = {};
  const positional = [];
  const withValue = ['organisations', 'out', 'contact', 'cache', 'skipped-out'];
  const flags = ['geocode', 'minify', 'help', 'skip-unlocated'];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const name = arg.slice(2);
    if (flags.includes(name)) {
      options[name] = true;
    } else if (withValue.includes(name)) {
      if (i + 1 >= argv.length) {
        throw new Error(`--${name} needs a value`);
      }
      options[name] = argv[++i];
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }

  return {options, positional};
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      return {};
    }
    throw new Error(`Couldn't read ${file}: ${e.message}`);
  }
}

async function main(argv, io = {log: console.log, error: console.error}) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (e) {
    io.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }

  const {options, positional} = parsed;
  if (options.help) {
    io.log(USAGE);
    return 0;
  }
  if (positional.length !== 1) {
    io.error(`Please give exactly one corporations CSV file.\n\n${USAGE}`);
    return 2;
  }
  if (options.geocode && !options.contact) {
    io.error(
      'The geocoding service requires you to identify yourself. Add --contact <your email address>.',
    );
    return 2;
  }

  const [corporationsFile] = positional;
  const outFile = options.out ?? 'database.json';
  const cacheFile = options.cache ?? `${corporationsFile}.geocode-cache.json`;

  let corporationsCsv;
  let organisationsCsv;
  try {
    corporationsCsv = fs.readFileSync(corporationsFile, 'utf8');
    if (options.organisations) {
      organisationsCsv = fs.readFileSync(options.organisations, 'utf8');
    }
  } catch (e) {
    io.error(`Couldn't read the file: ${e.message}`);
    return 2;
  }

  const cache = options.geocode ? readJsonFile(cacheFile) : undefined;
  const result = await buildDatabase({
    corporationsCsv,
    organisationsCsv,
    skipUnlocated: Boolean(options['skip-unlocated']),
    geocodeOptions: options.geocode
      ? {
          cache,
          userAgent: `couleurbummel-database-tool/1.0 (${options.contact})`,
        }
      : undefined,
  });

  if (cache) {
    // Keep what was looked up, even if the build failed for other reasons
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }

  for (const warning of result.warnings) {
    io.error(`Warning: ${warning}`);
  }

  if (result.skipped.length > 0) {
    if (options['skipped-out']) {
      fs.mkdirSync(path.dirname(path.resolve(options['skipped-out'])), {
        recursive: true,
      });
      fs.writeFileSync(
        options['skipped-out'],
        stringifyCsv(
          CORPORATION_COLUMNS,
          result.skipped.map(row => row.values),
        ),
      );
      io.error(
        `Left out ${result.skipped.length} corporations without coordinates, saved in ${options['skipped-out']}. Fill in their street and coordinates there and build again with both files.`,
      );
    } else {
      io.error(
        `Left out ${result.skipped.length} corporations without coordinates. Add --skipped-out <file> to save them.`,
      );
    }
  }

  if (result.errors.length > 0) {
    io.error(
      `\n${result.errors.length} problem(s) found, no database was written:`,
    );
    for (const error of result.errors) {
      io.error(`  - ${error}`);
    }
    return 1;
  }

  fs.mkdirSync(path.dirname(path.resolve(outFile)), {recursive: true});
  fs.writeFileSync(
    outFile,
    JSON.stringify(result.database, null, options.minify ? undefined : 2),
  );

  const s = result.stats;
  io.log(
    `Wrote ${outFile}: ${s.corporations} corporations, ${s.addresses} addresses, ${s.cities} cities, ${s.countries} countries, ${s.organisations} organisations.`,
  );
  return 0;
}

module.exports = {
  buildDatabase,
  stringifyCsv,
  CORPORATION_COLUMNS,
  main,
  parseCsv,
  readTable,
  resolveColour,
  parseSashes,
  FAMILIES,
  COLOURS,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    e => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
