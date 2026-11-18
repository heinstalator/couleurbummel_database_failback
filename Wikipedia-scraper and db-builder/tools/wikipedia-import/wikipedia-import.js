#!/usr/bin/env node
'use strict';

/**
 * Collects Studentenverbindungen from the German Wikipedia into a spreadsheet for tools/build-database.
 *
 * Starting at the "Liste der Listen von Studentenverbindungen", it reads the list of each city through Wikipedia's API
 * and turns the tables into rows of the corporations CSV: name, city, country, foundation date, colours, organisation
 * and fencing principle. Optionally it also takes coordinates from the corporations' own articles.
 *
 * Wikipedia's lists don't contain addresses, so rows usually need their street and coordinates completed afterwards.
 *
 * Run `node tools/wikipedia-import/wikipedia-import.js --help` for usage. It has no dependencies other than Node.js 18+.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  CORPORATION_COLUMNS,
  resolveColour,
  stringifyCsv,
} = require('../build-database/build-database');

const API_URL = 'https://de.wikipedia.org/w/api.php';
const INDEX_TITLE = 'Liste der Listen von Studentenverbindungen';
const CITY_LIST_TITLE =
  /^Liste der Studenten(?:- und Schüler)?verbindungen in (.+)$/;
const ORGANISATION_COLUMNS = ['abbreviation', 'name', 'indicatorColour'];
const COORDINATES_BATCH_SIZE = 50;

// The lists of Wikipedia group the cities by country, which the API doesn't tell us. These are the cities that the list
// of lists files under Austria and Switzerland. Every other city is assumed to be in Germany. Use --country to correct.
const AUSTRIAN_CITIES = [
  'Graz',
  'Innsbruck',
  'Klagenfurt',
  'Krems',
  'Leoben',
  'Linz',
  'Salzburg',
  'Wien',
];
const SWISS_CITIES = [
  'Basel',
  'Bern',
  'Burgdorf',
  'Freiburg im Üechtland',
  'Genf',
  'Lausanne',
  'Frauenfeld',
  'St. Gallen',
  'Zürich',
];

// ---------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
// Parts of a page that aren't content: footnote marks, edit links
const IGNORED_CLASSES = [
  'reference',
  'mw-editsection',
  'mw-empty-elt',
  'noprint',
];

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  shy: '\u00ad',
  ndash: '–',
  mdash: '—',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
};

function decodeEntities(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (match, body) => {
      if (body[0] === '#') {
        const code =
          body[1].toLowerCase() === 'x'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

function parseAttributes(text) {
  const attrs = {};
  const pattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = pattern.exec(text))) {
    attrs[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4] ?? '',
    );
  }
  return attrs;
}

const TOKEN =
  /<!--[\s\S]*?-->|<\/([a-zA-Z][^\s>]*)\s*>|<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * Parses HTML into a tree of nodes: `{tag, attrs, children}`, with text as `{tag: '#text', text}`.
 *
 * This is deliberately small. It copes with the well-formed HTML that Wikipedia produces, and with omitted end tags
 * in tables, but it isn't a general purpose parser.
 */
function parseHtml(html) {
  const root = {tag: '#root', attrs: {}, children: []};
  const stack = [root];
  const lower = html.toLowerCase();
  const top = () => stack[stack.length - 1];
  const addText = text => {
    if (text) {
      top().children.push({tag: '#text', text: decodeEntities(text)});
    }
  };
  const popWhile = tags => {
    while (stack.length > 1 && tags.includes(top().tag)) {
      stack.pop();
    }
  };

  let last = 0;
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(html))) {
    addText(html.slice(last, match.index));
    last = TOKEN.lastIndex;

    if (match[0].startsWith('<!--')) {
      continue;
    }

    if (match[1]) {
      const name = match[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const tag = match[2].toLowerCase();
    if (tag === 'tr') {
      popWhile(['td', 'th', 'tr']);
    } else if (tag === 'td' || tag === 'th') {
      popWhile(['td', 'th']);
    }

    const node = {tag, attrs: parseAttributes(match[3]), children: []};
    top().children.push(node);

    if (VOID_ELEMENTS.has(tag) || match[4]) {
      continue;
    }

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      // Skip the contents, which may contain characters that look like markup
      const end = lower.indexOf(`</${tag}`, last);
      const close = end === -1 ? -1 : html.indexOf('>', end);
      TOKEN.lastIndex = close === -1 ? html.length : close + 1;
      last = TOKEN.lastIndex;
      continue;
    }

    stack.push(node);
  }
  addText(html.slice(last));

  return root;
}

const hasClass = (node, name) =>
  (node.attrs?.class ?? '').split(/\s+/).includes(name);

const isIgnored = node =>
  node.tag === 'style' ||
  node.tag === 'script' ||
  IGNORED_CLASSES.some(c => hasClass(node, c));

/** Removes soft hyphens and invisible characters, and collapses white space */
function clean(text) {
  return text
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/** The text of a node as a reader would see it, without footnote marks */
function textOf(node) {
  let out = '';
  const visit = n => {
    if (n.tag === '#text') {
      out += n.text;
    } else if (!isIgnored(n)) {
      const separator =
        n.tag === 'br' || ['p', 'div', 'li', 'tr', 'td', 'th'].includes(n.tag)
          ? ' '
          : '';
      out += separator;
      n.children.forEach(visit);
      out += separator;
    }
  };
  visit(node);
  return clean(out);
}

/** Visits a node and everything in it, in document order, except parts that aren't content */
function walk(node, visit) {
  if (isIgnored(node)) {
    return;
  }
  visit(node);
  (node.children ?? []).forEach(child => walk(child, visit));
}

/** The links in a node that lead to articles that exist */
function linksOf(node) {
  const links = [];
  walk(node, n => {
    const href = n.tag === 'a' ? n.attrs.href ?? '' : '';
    if (!href.startsWith('/wiki/') || hasClass(n, 'new')) {
      return;
    }

    let target = href.slice('/wiki/'.length).split('#')[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep it as it is
    }
    target = target.replace(/_/g, ' ');
    if (
      /^(Datei|File|Bild|Kategorie|Spezial|Hilfe|Wikipedia|Portal|Vorlage):/.test(
        target,
      )
    ) {
      return;
    }

    links.push({text: textOf(n), title: n.attrs.title || target, target});
  });
  return links;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------------------------------

function rowsOf(table) {
  const rows = [];
  for (const child of table.children) {
    if (child.tag === 'tr') {
      rows.push(child);
    } else if (['thead', 'tbody', 'tfoot'].includes(child.tag)) {
      rows.push(...child.children.filter(c => c.tag === 'tr'));
    }
  }
  return rows;
}

/**
 * Turns a table into rows of cells, so that cells spanning several rows or columns appear in each place they cover.
 * A cell is `{header, text, links}`; a spanning cell is the same object everywhere.
 */
function tableToGrid(table) {
  const grid = [];
  const pending = []; // column -> {left, cell}: cells reaching down from earlier rows

  for (const tr of rowsOf(table)) {
    const row = [];
    let col = 0;
    const fillPending = () => {
      while (pending[col]?.left > 0) {
        row[col] = pending[col].cell;
        pending[col].left--;
        col++;
      }
    };

    for (const node of tr.children.filter(
      c => c.tag === 'td' || c.tag === 'th',
    )) {
      fillPending();

      const cell = {
        header: node.tag === 'th',
        text: textOf(node),
        links: linksOf(node),
      };
      const colspan = Math.max(1, parseInt(node.attrs.colspan, 10) || 1);
      const rowspan = Math.max(1, parseInt(node.attrs.rowspan, 10) || 1);
      for (let i = 0; i < colspan; i++) {
        row[col + i] = cell;
        if (rowspan > 1) {
          pending[col + i] = {left: rowspan - 1, cell};
        }
      }
      col += colspan;
    }
    fillPending();

    grid.push(row);
  }

  return grid;
}

/**
 * Finds the tables in a page together with the headings above them
 *
 * @returns for each table the path of headings (e.g. ["Aktive Verbindungen", "Corps"]) and its cells
 */
function extractTables(root) {
  const tables = [];
  const headings = [];

  walk(root, node => {
    const level = /^h([1-6])$/.exec(node.tag)?.[1];
    if (level) {
      headings[level - 1] = textOf(node);
      headings.length = Number(level);
    } else if (node.tag === 'table') {
      tables.push({
        sections: headings.filter(Boolean),
        grid: tableToGrid(node),
      });
    }
  });

  return tables;
}

const HEADERS = [
  ['name', /^(name|verbindung|verbindungen|name der verbindung)$/],
  ['sitz', /^(sitz|ort|stadt|hochschulort|hochschulstandort)$/],
  ['gruendung', /^(gründung|gegründet|gründungsdatum|gründungsjahr)$/],
  ['farben', /^(farben|couleur|couleurfarben)$/],
  ['verband', /^(verband|dachverband|korporationsverband|verbände)$/],
  ['fechtfrage', /^(fechtfrage|fechten|schlagend)$/],
  ['status', /^(status|aktiv)$/],
  ['wahlspruch', /^(wahlspruch|motto|devise)$/],
];

const normaliseHeader = text =>
  clean(text)
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Finds which column holds what, going by the names of the columns */
function mapColumns(texts) {
  const columns = {};
  texts.forEach((text, index) => {
    const header = normaliseHeader(text);
    const found = HEADERS.find(
      ([key, pattern]) => !(key in columns) && pattern.test(header),
    );
    if (found) {
      columns[found[0]] = index;
    }
  });
  return columns;
}

// ---------------------------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------------------------

function transliterate(s) {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue');
}

const MONTHS = {
  jan: 1,
  feb: 2,
  mae: 3,
  mar: 3,
  apr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dez: 12,
};

/**
 * Reads a foundation date such as "1819", "1. Juli 1960" or "14. Jan. 1861"
 *
 * @returns "yyyy-MM-dd" or "yyyy", or an empty string if there is none
 */
function parseFoundation(text) {
  const date = /(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]{3,})\.?\s*(\d{4})/.exec(text);
  if (date) {
    const month = MONTHS[transliterate(date[2]).slice(0, 3)];
    const day = Number(date[1]);
    if (month && day >= 1 && day <= 31) {
      return `${date[3]}-${String(month).padStart(2, '0')}-${String(
        day,
      ).padStart(2, '0')}`;
    }
  }

  return /\b(1[2-9]\d\d|20\d\d)\b/.exec(text)?.[1] ?? '';
}

// German colour words and the colours of the builder's palette that they stand for
const COLOUR_WORDS = {
  schwarz: 'black',
  weiss: 'white',
  blau: 'blue',
  hellblau: 'blue_light',
  himmelblau: 'blue_light',
  dunkelblau: 'blue_dark',
  gruen: 'green',
  hellgruen: 'green_light',
  dunkelgruen: 'green_dark',
  moosgruen: 'green_moss',
  rot: 'red',
  dunkelrot: 'red_dark',
  weinrot: 'red_wine',
  bordeaux: 'red_bordeaux',
  bordeauxrot: 'red_bordeaux',
  karmesin: 'red_crimson',
  karmesinrot: 'red_crimson',
  karmin: 'red_crimson',
  orange: 'orange',
  gelb: 'yellow',
  gold: 'gold',
  silber: 'silver',
  grau: 'grey',
  hellgrau: 'grey_light',
  rosa: 'pink',
  violett: 'purple',
  lila: 'purple',
  purpur: 'purple',
  braun: 'brown',
};

// Shades that the palette has no colour for, and the closest it has
const APPROXIMATE_COLOUR_WORDS = {
  blassrot: 'red',
  hellrot: 'red',
  altgold: 'gold',
  goldgelb: 'yellow',
  dunkelgrau: 'grey',
  hellgelb: 'yellow',
  dunkelbraun: 'brown',
  hellbraun: 'brown',
  hellorange: 'orange',
  dunkelorange: 'orange',
  hellviolett: 'purple',
  dunkelviolett: 'purple',
  kohle: 'black',
  kohlschwarz: 'black',
  anthrazit: 'grey',
};

const BASE_COLOUR_WORDS = [
  'schwarz',
  'weiss',
  'blau',
  'gruen',
  'rot',
  'gelb',
  'grau',
  'braun',
  'silber',
  'gold',
  'orange',
  'rosa',
  'lila',
  'violett',
];

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

// Endings of German adjectives, as in "weißem Grund" or "goldener Perkussion"
const ADJECTIVE_ENDINGS = /(em|en|er|es|e|n)$/;

/**
 * Finds the colour of the palette that a German colour word stands for
 *
 * @returns `name`, and `approximate` if a shade that the palette lacks was replaced by the closest colour; undefined if
 * the word isn't a colour
 */
function resolveWord(word) {
  const candidates = [word];
  let stem = word;
  for (let i = 0; i < 3; i++) {
    const ending = ADJECTIVE_ENDINGS.exec(stem);
    if (!ending) {
      break;
    }
    stem = stem.slice(0, -ending[1].length);
    candidates.push(stem);
  }

  for (const candidate of candidates) {
    if (hasOwn(COLOUR_WORDS, candidate)) {
      return {name: COLOUR_WORDS[candidate], approximate: false};
    }
    if (hasOwn(APPROXIMATE_COLOUR_WORDS, candidate)) {
      return {name: APPROXIMATE_COLOUR_WORDS[candidate], approximate: true};
    }
  }

  const base = BASE_COLOUR_WORDS.find(b => word.endsWith(b));
  if (base) {
    return {name: COLOUR_WORDS[base], approximate: true};
  }

  try {
    resolveColour(word);
    return {name: word, approximate: false};
  } catch {
    return undefined;
  }
}

const BOTTOM_UP = /^v\.?\s*u\.?$/i;
const COLOURS_LED = /^f\.?\s*f\.?$/i;

/**
 * Turns the colours of a corporation, as written on Wikipedia, into the form of the corporations CSV
 *
 * Wikipedia writes the stripes of a sash separated by hyphens. "(v.u.)" says they are listed from the bottom up. "auf
 * weißem Grund" gives the base colour and "Perkussion" with a colour the percussion. Shades that the palette lacks are
 * replaced by the closest colour. Other remarks in brackets are ignored.
 *
 * "(f.f.)" means "farbenführend": the corporation has colours, but doesn't wear them. The lists say that all others are
 * "farbentragend", so those get the principle "wearing is mandatory".
 *
 * @returns `colours`: the value for the CSV, empty if a colour couldn't be read; `principle`: the colours principle;
 * `approximated`: the words that were replaced by a similar colour; `unknown`: words that couldn't be read;
 * `annotations`: the other remarks in brackets
 */
function parseColours(text) {
  const result = {
    colours: '',
    principle: 0,
    approximated: [],
    unknown: [],
    annotations: [],
  };
  const sashes = [];
  let hasColours = false;
  let notWorn = false;

  const resolve = word => {
    const found = resolveWord(word);
    if (!found) {
      result.unknown.push(word);
      return undefined;
    }
    if (found.approximate) {
      result.approximated.push(word);
    }
    return found.name;
  };

  for (const part of text.split(/[;/]|\bbzw\.|\boder\b/i)) {
    const annotations = [...part.matchAll(/\(([^)]*)\)/g)].map(m =>
      m[1].trim(),
    );
    const bottomUp = annotations.some(a => BOTTOM_UP.test(a));
    notWorn ||= annotations.some(a => COLOURS_LED.test(a));
    result.annotations.push(
      ...annotations.filter(a => !BOTTOM_UP.test(a) && !COLOURS_LED.test(a)),
    );

    let rest = transliterate(part.replace(/\([^)]*\)/g, ' '))
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/\bmit\b/g, ' ');
    const take = pattern => {
      const match = pattern.exec(rest);
      if (match) {
        rest = rest.replace(match[0], ' ');
      }
      return match?.[1];
    };
    const baseWord = take(/\bauf\s+([a-z]+)\s+(?:untergrund|grund)\b/);
    const percussionWord =
      take(/\bperkussion\s*:?\s*([a-z]+)/) ?? take(/\b([a-z]+)\s+perkussion\b/);

    const words = rest
      .split(/\s*-\s*|\s+/)
      .map(w => w.replace(/[^a-z]/g, ''))
      .filter(Boolean);
    if (words.length === 0) {
      continue;
    }
    hasColours = true;

    // Look at every word, so that all the ones that can't be read are reported
    const stripes = words.map(resolve);
    const base = baseWord && resolve(baseWord);
    const percussion = percussionWord && resolve(percussionWord);
    if (
      stripes.some(s => !s) ||
      (baseWord && !base) ||
      (percussionWord && !percussion)
    ) {
      continue;
    }

    sashes.push(
      (bottomUp ? stripes.reverse() : stripes).join('-') +
        (base ? `@${base}` : '') +
        (percussion ? `+${percussion}` : ''),
    );
  }

  result.colours = result.unknown.length === 0 ? sashes.join('|') : '';
  result.principle = notWorn ? 3 : hasColours ? 5 : 0;
  return result;
}

/**
 * Turns the "Fechtfrage" of a corporation into the number of the fencing principle
 *
 * @returns `value`: 0 if unknown; `known`: false if the text is not empty but wasn't understood
 */
function parseFencing(text) {
  const t = transliterate(text);
  if (!t.trim()) {
    return {value: 0, known: true};
  }
  if (/nicht\s*-?\s*schlagend|nicht\s*-?\s*fechtend/.test(t)) {
    return {value: 1, known: true};
  }
  if (/pflicht\s*-?\s*schlagend/.test(t)) {
    return {value: 4, known: true};
  }
  if (/pflicht\s*-?\s*fecht/.test(t)) {
    return {value: 3, known: true};
  }
  if (/fakultativ|freiwillig|frei\s*-?\s*schlagend/.test(t)) {
    return {value: 2, known: true};
  }
  return {value: 0, known: false};
}

/**
 * Reads the organisations of a corporation from the cell of the associations
 *
 * @returns the abbreviations, and the full names where the abbreviation links to an article with a different title
 */
function parseOrganisations(cell) {
  const abbreviations = [];
  const names = new Map();

  const tokens = cell.text
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:,|;|\/|\+|&|\bund\b)\s*/i)
    .map(t => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (/^(verbandsfrei|frei|keiner?|[-–—?])$/i.test(token)) {
      continue;
    }

    abbreviations.push(token);
    const link = cell.links.find(
      l => l.text.toLowerCase() === token.toLowerCase(),
    );
    if (link && link.title.toLowerCase() !== token.toLowerCase()) {
      names.set(token, link.title);
    }
  }

  return {abbreviations, names};
}

const INACTIVE =
  /vertagt|suspendiert|ruhend|inaktiv|ehemalig|aufgel[öo]st|erloschen|historisch|nicht mehr|früher|†/i;
const PUPIL = /schüler/i;

function cityOfTitle(title) {
  return CITY_LIST_TITLE.exec(title)?.[1];
}

const cityKey = city => clean(city).toLowerCase();

function countryOfCity(city, overrides = new Map()) {
  const key = cityKey(city);
  if (overrides.has(key)) {
    return overrides.get(key);
  }
  if (AUSTRIAN_CITIES.some(c => cityKey(c) === key)) {
    return 'AT';
  }
  if (SWISS_CITIES.some(c => cityKey(c) === key)) {
    return 'CH';
  }
  return 'DE';
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading list pages
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Reads the corporations from the HTML of a list page
 *
 * @returns the records, and how many were left out because they are inactive or school fraternities
 */
function parseListPage(html) {
  const records = [];
  const left = {inactive: [], pupil: [], tables: 0};

  for (const {sections, grid} of extractTables(parseHtml(html))) {
    const headerIndex = grid.slice(0, 3).findIndex(row => {
      const columns = mapColumns(row.map(c => c.text));
      return (
        columns.name !== undefined &&
        ['gruendung', 'farben', 'verband'].some(k => columns[k] !== undefined)
      );
    });
    if (headerIndex === -1) {
      continue;
    }

    left.tables++;
    const headerTexts = grid[headerIndex].map(c => normaliseHeader(c.text));
    const columns = mapColumns(grid[headerIndex].map(c => c.text));
    let subsection = '';

    for (const row of grid.slice(headerIndex + 1)) {
      // A row of one cell spanning the whole table is a heading within the table
      if (row.length > 1 && new Set(row).size === 1) {
        subsection = row[0].text;
        continue;
      }
      if (
        row.every((cell, i) => normaliseHeader(cell.text) === headerTexts[i])
      ) {
        continue;
      }

      const text = key =>
        columns[key] === undefined ? '' : row[columns[key]]?.text ?? '';
      const nameCell = row[columns.name];
      const name = text('name')
        .replace(/\s*†\s*$/, '')
        .trim();
      if (!nameCell || !name) {
        continue;
      }

      const record = {
        name,
        target: nameCell.links[0]?.target,
        sitz: text('sitz'),
        foundation: text('gruendung'),
        colours: text('farben'),
        verband:
          columns.verband === undefined ? undefined : row[columns.verband],
        fencing: text('fechtfrage'),
        motto: text('wahlspruch'),
      };

      const context = [...sections, subsection].join(' / ');
      const inactive =
        INACTIVE.test(context) ||
        INACTIVE.test(text('status')) ||
        /†/.test(text('name'));
      const pupil = PUPIL.test(context);
      if (pupil) {
        left.pupil.push({...record, inactive});
      } else if (inactive) {
        left.inactive.push({...record, inactive});
      } else {
        records.push({...record, inactive: false});
      }
    }
  }

  return {records, left};
}

// ---------------------------------------------------------------------------------------------------------------------
// Wikipedia API
// ---------------------------------------------------------------------------------------------------------------------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A client for the API of the German Wikipedia
 *
 * It follows Wikimedia's etiquette: it identifies itself, asks for one thing at a time with a pause in between, and
 * waits when it is told to slow down. Answers can be kept in a directory, so that nothing is asked twice.
 */
function createClient({
  userAgent,
  fetchImpl = fetch,
  cacheDir,
  refresh = false,
  wait = sleep,
  delayMs = 250,
  maxRetries = 3,
}) {
  async function request(params) {
    const url = `${API_URL}?${new URLSearchParams({
      format: 'json',
      formatversion: '2',
      ...params,
    })}`;
    const cacheFile = cacheDir
      ? path.join(
          cacheDir,
          `${crypto.createHash('sha1').update(url).digest('hex')}.json`,
        )
      : undefined;

    if (cacheFile && !refresh && fs.existsSync(cacheFile)) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }

    for (let attempt = 0; ; attempt++) {
      await wait(delayMs);
      const response = await fetchImpl(url, {
        headers: {'User-Agent': userAgent, Accept: 'application/json'},
      });

      if (
        (response.status === 429 || response.status === 503) &&
        attempt < maxRetries
      ) {
        const seconds = Number(response.headers?.get?.('retry-after')) || 5;
        await wait(seconds * 1000);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Wikipedia answered with status ${response.status}`);
      }

      const json = await response.json();
      if (json.error) {
        throw new Error(`${json.error.code}: ${json.error.info}`);
      }

      if (cacheFile) {
        fs.mkdirSync(cacheDir, {recursive: true});
        fs.writeFileSync(cacheFile, JSON.stringify(json));
      }
      return json;
    }
  }

  return {
    /** The pages that a page links to: `[{ns, title, exists}]` */
    async links(title) {
      const result = await request({
        action: 'parse',
        page: title,
        prop: 'links',
        redirects: '1',
      });
      return result.parse.links ?? [];
    },

    /** The HTML of a page */
    async html(title) {
      const result = await request({
        action: 'parse',
        page: title,
        prop: 'text',
        redirects: '1',
        disableeditsection: '1',
        disabletoc: '1',
        disablelimitreport: '1',
      });
      return result.parse.text;
    },

    /** The main coordinates of articles, as a map from the requested title to `{latitude, longitude}` */
    async coordinates(titles) {
      const result = await request({
        action: 'query',
        prop: 'coordinates',
        titles: titles.join('|'),
        colimit: 'max',
        coprimary: 'primary',
        redirects: '1',
      });

      const query = result.query ?? {};
      const renamed = new Map(
        [...(query.normalized ?? []), ...(query.redirects ?? [])].map(r => [
          r.from,
          r.to,
        ]),
      );
      const found = new Map();
      for (const page of query.pages ?? []) {
        const [coordinates] = page.coordinates ?? [];
        if (coordinates) {
          found.set(page.title, {
            latitude: coordinates.lat,
            longitude: coordinates.lon,
          });
        }
      }

      const byTitle = new Map();
      for (const title of titles) {
        let resolved = title;
        for (let i = 0; i < 5 && renamed.has(resolved); i++) {
          resolved = renamed.get(resolved);
        }
        if (found.has(resolved)) {
          byTitle.set(title, found.get(resolved));
        }
      }
      return byTitle;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Finds the lists to read among the links of the list of lists
 *
 * @param links - the links of the list of lists
 * @param options - `cities`: only the lists of these cities; `lists`: a regular expression for further lists
 */
function selectLists(links, {cities, lists} = {}) {
  const titles = [
    ...new Set(
      links.filter(l => l.ns === 0 && l.exists !== false).map(l => l.title),
    ),
  ];
  const wanted = cities?.map(cityKey);

  const selected = [];
  for (const title of titles) {
    const city = cityOfTitle(title);
    if (city) {
      if (
        !wanted ||
        wanted.some(
          w => cityKey(city).split(/ und /).includes(w) || cityKey(city) === w,
        )
      ) {
        selected.push({title, city});
      }
    } else if (lists?.test(title)) {
      selected.push({title, city: undefined});
    }
  }

  return selected;
}

/**
 * Collects the corporations of the lists on Wikipedia
 *
 * @param client - see createClient
 * @param options - `indexTitle`, `cities`, `lists` (a RegExp), `limit`, `includeInactive`, `includePupil`,
 * `countries` (a Map from lower case city to country code), `coordinates` (look up coordinates in the articles),
 * `listOnly` (only find the lists)
 * @param log - receives progress messages
 */
async function importFromWikipedia(client, options = {}, log = () => {}) {
  const warnings = [];
  const countries = options.countries ?? new Map();

  const links = await client.links(options.indexTitle ?? INDEX_TITLE);
  let lists = selectLists(links, options);
  if (options.limit) {
    lists = lists.slice(0, options.limit);
  }
  for (const list of lists) {
    list.country = list.city
      ? countryOfCity(list.city.split(/ und /)[0], countries)
      : undefined;
  }

  if (options.listOnly) {
    return {
      lists,
      rows: [],
      organisations: [],
      warnings,
      report: '',
      stats: {
        lists: lists.length,
        tables: 0,
        corporations: 0,
        duplicates: 0,
        inactive: 0,
        pupil: 0,
        withCoordinates: 0,
      },
    };
  }

  const stats = {
    lists: lists.length,
    tables: 0,
    corporations: 0,
    duplicates: 0,
    inactive: 0,
    pupil: 0,
    withCoordinates: 0,
  };
  const annotations = new Map();
  // What the tool didn't fully understand, counted over all lists: kind -> word -> number of corporations
  const attention = {
    unknownColours: new Map(),
    approximatedColours: new Map(),
    fencing: new Map(),
  };
  const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  // Cities whose country is known: those that have a list of their own, whether or not it is read in this run
  const knownCities = new Set(
    selectLists(links)
      .flatMap(l => l.city.split(/ und /))
      .map(cityKey),
  );
  const unknownCities = new Set();
  const organisationNames = new Map(); // lower case abbreviation -> {abbreviation, name}
  const rows = [];
  const targets = []; // article title per row, if there is one
  const seen = new Map();
  const perList = [];

  for (const list of lists) {
    log(`Reading ${list.title}`);

    let html;
    try {
      html = await client.html(list.title);
    } catch (e) {
      warnings.push(`${list.title}: couldn't be read (${e.message})`);
      perList.push({title: list.title, rows: 0});
      continue;
    }

    const {records, left} = parseListPage(html);
    stats.tables += left.tables;
    stats.inactive += left.inactive.length;
    stats.pupil += left.pupil.length;

    const included = [
      ...records,
      ...(options.includeInactive
        ? left.inactive.filter(r => !PUPIL.test(r.name))
        : []),
      ...(options.includePupil ? left.pupil : []),
    ];
    if (left.tables === 0) {
      warnings.push(
        `${list.title}: no table of corporations was found. Wikipedia's layout may have changed.`,
      );
    }

    let added = 0;
    for (const record of included) {
      const sitz = record.sitz.split(',')[0].trim();
      const city = sitz || list.city?.split(/ und /)[0];
      if (!city) {
        warnings.push(
          `${list.title}: "${record.name}" has no city and was left out`,
        );
        continue;
      }
      if (!sitz && list.city?.includes(' und ')) {
        warnings.push(
          `${list.title}: "${record.name}" is placed in ${city}; the list covers ${list.city}. Check the city.`,
        );
      }

      const country = countryOfCity(city, countries);
      if (
        !list.city &&
        !knownCities.has(cityKey(city)) &&
        !countries.has(cityKey(city)) &&
        countryOfCity(city) === 'DE'
      ) {
        unknownCities.add(city);
      }

      const key = `${transliterate(record.name).replace(
        /[^a-z0-9]/g,
        '',
      )}|${cityKey(city)}`;
      const colours = parseColours(record.colours);
      const fencing = parseFencing(record.fencing);
      const organisations = record.verband
        ? parseOrganisations(record.verband)
        : {abbreviations: [], names: new Map()};

      const label = `${list.title}: "${record.name}"`;
      if (colours.unknown.length > 0) {
        warnings.push(
          `${label}: couldn't read the colours "${
            record.colours
          }" (unknown: ${colours.unknown.join(', ')})`,
        );
      }
      if (colours.approximated.length > 0) {
        warnings.push(
          `${label}: replaced ${colours.approximated.join(
            ', ',
          )} by the closest colour in the palette`,
        );
      }
      colours.unknown.forEach(w => count(attention.unknownColours, w));
      colours.approximated.forEach(w =>
        count(attention.approximatedColours, w),
      );
      for (const annotation of colours.annotations) {
        annotations.set(annotation, (annotations.get(annotation) ?? 0) + 1);
      }
      if (!fencing.known) {
        warnings.push(
          `${label}: didn't understand the fencing principle "${record.fencing}"`,
        );
      }
      if (!fencing.known) {
        count(attention.fencing, record.fencing);
      }

      const row = {
        shortName: record.name,
        longName: record.name,
        city,
        country,
        organisations: organisations.abbreviations.join('|'),
        fencingPrinciple: fencing.value || '',
        foundationDate: parseFoundation(record.foundation),
        motto: record.motto,
        coloursPrinciple: colours.principle || '',
        colours: colours.colours,
        hidden: record.inactive ? 'yes' : '',
      };

      const existing = seen.get(key);
      if (existing) {
        // The same corporation in another list: take over what the first one lacks
        stats.duplicates++;
        for (const column of Object.keys(row)) {
          if (!rows[existing.index][column] && row[column]) {
            rows[existing.index][column] = row[column];
          }
        }
        targets[existing.index] ??= record.target;
      } else {
        seen.set(key, {index: rows.length});
        rows.push(row);
        targets.push(record.target);
        added++;
      }

      for (const abbreviation of organisations.abbreviations) {
        const known = organisationNames.get(abbreviation.toLowerCase());
        const name = organisations.names.get(abbreviation);
        if (!known) {
          organisationNames.set(abbreviation.toLowerCase(), {
            abbreviation,
            name: name ?? abbreviation,
          });
        } else if (name && known.name === known.abbreviation) {
          known.name = name;
        }
      }
    }
    perList.push({title: list.title, rows: added});
  }

  if (unknownCities.size > 0) {
    warnings.push(
      `The country of ${[...unknownCities]
        .sort()
        .join(
          ', ',
        )} isn't known, so Germany was assumed. Correct it with --country "City=XX".`,
    );
  }

  if (options.coordinates) {
    const titles = [...new Set(targets.filter(Boolean))];
    log(`Looking up the coordinates of ${titles.length} articles`);

    for (let i = 0; i < titles.length; i += COORDINATES_BATCH_SIZE) {
      const batch = titles.slice(i, i + COORDINATES_BATCH_SIZE);
      let found;
      try {
        found = await client.coordinates(batch);
      } catch (e) {
        warnings.push(
          `Coordinates of ${batch.length} articles couldn't be looked up (${e.message})`,
        );
        continue;
      }

      targets.forEach((target, index) => {
        const coordinates = target && found.get(target);
        if (coordinates && !rows[index].latitude) {
          rows[index].latitude = coordinates.latitude;
          rows[index].longitude = coordinates.longitude;
          stats.withCoordinates++;
        }
      });
    }
  }

  stats.corporations = rows.length;

  const organisations = [...organisationNames.values()].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation),
  );

  return {
    lists,
    rows,
    organisations,
    warnings,
    stats,
    report: createReport({
      attention,
      lists: perList,
      stats,
      warnings,
      annotations,
      options,
    }),
  };
}

function attentionLines(title, counts) {
  if (counts.size === 0) {
    return [`  ${title}: none`];
  }
  return [
    `  ${title}:`,
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([word, n]) => `    "${word}" x${n}`),
  ];
}

function createReport({
  attention,
  lists,
  stats,
  warnings,
  annotations,
  options,
}) {
  const lines = [
    'Import from the German Wikipedia',
    '',
    `Lists read: ${stats.lists}, tables with corporations: ${stats.tables}`,
    `Corporations: ${stats.corporations}${
      stats.duplicates ? ` (${stats.duplicates} duplicates merged)` : ''
    }`,
    `Left out: ${stats.inactive} inactive${
      options.includeInactive ? ' (included, marked hidden)' : ''
    }, ${stats.pupil} school fraternities${
      options.includePupil ? ' (included)' : ''
    }`,
    `Coordinates from articles: ${
      options.coordinates ? stats.withCoordinates : 'not requested'
    }`,
    `Corporations still without coordinates: ${
      stats.corporations - stats.withCoordinates
    }`,
    '',
    'Words that need your attention (the number is how many corporations they occur in):',
    ...attentionLines(
      'Colours that could not be read, so the colours were left empty',
      attention.unknownColours,
    ),
    ...attentionLines(
      'Shades replaced by the closest colour of the palette',
      attention.approximatedColours,
    ),
    ...attentionLines(
      'Fencing principles that were not understood',
      attention.fencing,
    ),
    '',
    'Other remarks in brackets after the colours, which are ignored:',
    ...(annotations.size > 0
      ? [...annotations.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([a, n]) => `  (${a}) x${n}`)
      : ['  none']),
    '',
    `Warnings (${warnings.length}):`,
    ...(warnings.length > 0 ? warnings.map(w => `  - ${w}`) : ['  none']),
    '',
    'Lists:',
    ...lists.map(l => `  ${String(l.rows).padStart(4)}  ${l.title}`),
    '',
    'The content of Wikipedia is available under the Creative Commons Attribution-ShareAlike license (CC BY-SA 4.0).',
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------

const USAGE = `Collects Studentenverbindungen from the German Wikipedia into CSV files for the database builder.

Usage:
  node tools/wikipedia-import/wikipedia-import.js --contact <email> [options]

Options:
  --contact <email>            Required. Your contact address, which Wikimedia asks every program to send
  --out <file>                 Corporations CSV (default: wikipedia-corporations.csv)
  --organisations-out <file>   Organisations CSV (default: wikipedia-organisations.csv)
  --report <file>              Text file with what was found and what needs attention (default: wikipedia-report.txt)
  --cities <names>             Only these cities, separated by commas, e.g. Aachen,Bonn,Wien
  --lists <regex>              Also read lists whose title matches, e.g. "Liste der Kösener Corps"
  --country "<City>=<XX>"      Set the country of a city, e.g. "Bern=CH". Can be repeated
  --coordinates                Take coordinates from the corporations' own articles, where they have some
  --include-inactive           Keep inactive corporations, marked as hidden
  --include-pupil              Keep school fraternities
  --limit <n>                  Only read the first n lists
  --list-only                  Only show which lists were found and their countries, then stop
  --cache-dir <dir>            Where to keep answers of Wikipedia (default: .wikipedia-cache)
  --refresh                    Ask Wikipedia again even if there is a kept answer
  --index <title>              The list of lists to start from (default: ${INDEX_TITLE})
  --help                       Show this text

See tools/wikipedia-import/README.md for what to do with the result.`;

function parseArguments(argv) {
  const options = {country: []};
  const withValue = [
    'contact',
    'out',
    'organisations-out',
    'report',
    'cities',
    'lists',
    'country',
    'limit',
    'cache-dir',
    'index',
  ];
  const flags = [
    'coordinates',
    'include-inactive',
    'include-pupil',
    'list-only',
    'refresh',
    'help',
  ];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument ${arg}`);
    }

    const name = arg.slice(2);
    if (flags.includes(name)) {
      options[name] = true;
    } else if (withValue.includes(name)) {
      if (i + 1 >= argv.length) {
        throw new Error(`--${name} needs a value`);
      }
      const value = argv[++i];
      if (name === 'country') {
        options.country.push(value);
      } else {
        options[name] = value;
      }
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }

  return options;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  fs.writeFileSync(file, content);
}

async function main(
  argv,
  io = {log: console.log, error: console.error},
  dependencies = {},
) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (e) {
    io.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    io.log(USAGE);
    return 0;
  }
  if (!options.contact) {
    io.error(
      'Wikimedia asks programs to identify themselves. Add --contact <your email address>.',
    );
    return 2;
  }

  const countries = new Map();
  for (const entry of options.country) {
    const match = /^(.+)=([A-Za-z]{2,3})$/.exec(entry);
    if (!match) {
      io.error(`--country needs the form "City=XX", not "${entry}"`);
      return 2;
    }
    countries.set(cityKey(match[1]), match[2].toUpperCase());
  }

  let lists;
  if (options.lists) {
    try {
      lists = new RegExp(options.lists);
    } catch (e) {
      io.error(`--lists is not a valid regular expression: ${e.message}`);
      return 2;
    }
  }

  const client =
    dependencies.client ??
    createClient({
      userAgent: `couleurbummel-wikipedia-import/1.0 (${options.contact})`,
      cacheDir: options['cache-dir'] ?? '.wikipedia-cache',
      refresh: Boolean(options.refresh),
    });

  let result;
  try {
    result = await importFromWikipedia(
      client,
      {
        indexTitle: options.index,
        cities: options.cities
          ?.split(',')
          .map(c => c.trim())
          .filter(Boolean),
        lists,
        limit: options.limit ? Number(options.limit) : undefined,
        includeInactive: Boolean(options['include-inactive']),
        includePupil: Boolean(options['include-pupil']),
        countries,
        coordinates: Boolean(options.coordinates),
        listOnly: Boolean(options['list-only']),
      },
      message => io.log(message),
    );
  } catch (e) {
    io.error(`Couldn't read from Wikipedia: ${e.message}`);
    return 1;
  }

  if (options['list-only']) {
    for (const list of result.lists) {
      io.log(
        `${list.country ?? '??'}  ${list.city ?? '(city from the list)'}  ←  ${
          list.title
        }`,
      );
    }
    io.log(
      `${result.lists.length} lists found. Fix countries with --country "City=XX".`,
    );
    return 0;
  }

  const out = options.out ?? 'wikipedia-corporations.csv';
  const organisationsOut =
    options['organisations-out'] ?? 'wikipedia-organisations.csv';
  const reportFile = options.report ?? 'wikipedia-report.txt';

  writeFile(out, stringifyCsv(CORPORATION_COLUMNS, result.rows));
  writeFile(
    organisationsOut,
    stringifyCsv(
      ORGANISATION_COLUMNS,
      result.organisations.map(o => ({
        abbreviation: o.abbreviation,
        name: o.name,
        indicatorColour: '',
      })),
    ),
  );
  writeFile(reportFile, result.report);

  const s = result.stats;
  io.log(
    `Wrote ${s.corporations} corporations from ${s.lists} lists to ${out}, ${result.organisations.length} organisations to ${organisationsOut}.`,
  );
  io.log(
    `${s.corporations - s.withCoordinates} of them have no coordinates yet. ${
      result.warnings.length
    } warnings, see ${reportFile}.`,
  );
  return 0;
}

module.exports = {
  createClient,
  extractTables,
  importFromWikipedia,
  main,
  parseColours,
  parseFencing,
  parseFoundation,
  parseHtml,
  parseListPage,
  parseOrganisations,
  selectLists,
  textOf,
  countryOfCity,
  cityOfTitle,
  COLOUR_WORDS,
  APPROXIMATE_COLOUR_WORDS,
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
