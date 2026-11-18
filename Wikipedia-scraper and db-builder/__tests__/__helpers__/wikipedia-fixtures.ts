/**
 * Pages in the shape in which Wikipedia's API delivers them, and a stand-in for the API.
 *
 * The tables follow the lists on the German Wikipedia: a header row with the soft hyphens that the real pages
 * contain, images in the columns for coats of arms, footnote marks, links to articles (and to articles that don't
 * exist), cells spanning several rows, and sections for inactive corporations.
 */

const link = (title: string, text = title) =>
  `<a href="/wiki/${encodeURIComponent(
    title.replace(/ /g, '_'),
  )}" title="${title}">${text}</a>`;

const redLink = (title: string) =>
  `<a href="/w/index.php?title=${encodeURIComponent(
    title.replace(/ /g, '_'),
  )}&amp;action=edit&amp;redlink=1" class="new" title="${title} (Seite nicht vorhanden)">${title}</a>`;

const image = `<span typeof="mw:File"><a href="/wiki/Datei:Wappen.jpg" class="mw-file-description"><img alt="" src="//upload.wikimedia.org/x.jpg" width="40" height="40" /></a></span>`;

const reference = (n: number) =>
  `<sup id="cite_ref-${n}" class="reference"><a href="#cite_note-${n}">[${n}]</a></sup>`;

const HEADER =
  '<tr><th>Name</th><th>Gründung</th><th>Farben</th><th class="unsortable">Wappen</th><th class="unsortable">Zirkel</th>' +
  '<th>Ver&shy;band</th><th>Fechtfrage</th><th>Mitglieder</th><th class="unsortable">Anmerkungen</th></tr>';

const row = (
  name: string,
  founded: string,
  colours: string,
  association: string,
  fencing: string,
  members = 'Männer',
) =>
  `<tr><td>${name}</td><td data-sort-value="${founded}">${founded}</td><td>${colours}</td><td>${image}</td><td></td>` +
  `<td>${association}</td><td>${fencing}</td><td>${members}</td><td></td></tr>`;

const heading = (level: number, text: string) =>
  `<div class="mw-heading mw-heading${level}"><h${level} id="${text.replace(
    / /g,
    '_',
  )}">${text}</h${level}></div>`;

const navbox =
  '<table class="navbox"><tbody><tr><th>Listen</th><td>Alle Listen</td></tr></tbody></table>';

export const aachenHtml =
  '<div class="mw-content-ltr mw-parser-output" lang="de" dir="ltr">' +
  `<style data-mw-deduplicate="TemplateStyles:r1">.mw-parser-output .x > td { color: red }</style>` +
  `<p>In <b>Aachen</b> gibt es 40 verschiedene Studentenverbindungen.${reference(
    1,
  )}</p>` +
  heading(2, 'Aktive Verbindungen') +
  '<table class="wikitable sortable"><tbody>' +
  HEADER +
  row(
    link(
      'Corps Saxo-Montania zu Freiberg und Dresden in Aachen',
      'Corps Saxo-Montania',
    ),
    '1798',
    'blau-weiß-gold',
    link('Weinheimer Senioren-Convent', 'WSC'),
    'pflichtschlagend',
  ) +
  // The association spans two rows, as lists of Wikipedia do when neighbours share a value
  `<tr><td>${redLink(
    'Corps Borussia Breslau zu Köln und Aachen',
  )}</td><td>1819</td><td>schwarz-blassrot-weiß</td><td>${image}</td><td></td>` +
  `<td rowspan="2">${link('Kösener Senioren-Convents-Verband', 'KSCV')}, ${link(
    'Weinheimer Senioren-Convent',
    'WSC',
  )}</td>` +
  '<td>pflichtschlagend</td><td>Männer</td><td></td></tr>' +
  `<tr><td>Corps Delta${reference(
    2,
  )}</td><td>1871</td><td>weiß&#8211;rot&#8211;gold</td><td></td><td></td>` +
  '<td>pflichtschlagend</td><td>Männer</td><td></td></tr>' +
  row(
    link('Aachener Burschenschaft Teutonia'),
    '1899',
    'schwarz-weinrot-gold (v.u.)',
    link('Allgemeiner Deutscher Burschenbund', 'ADB'),
    'fakultativ schlagend',
  ) +
  row(
    'Danziger Burschenschaft Alemannia',
    '27. Jan. 1920',
    'rot-gold-schwarz',
    'NDB',
    'fakultativ schlagend',
  ) +
  row(
    'Akademischer Verein Test',
    '1878',
    'schwarz-gold (f.f.)',
    'verbandsfrei',
    '',
    'gemischt',
  ) +
  // A heading inside the table and a repeated header row
  '<tr><th colspan="9">Vertagte Verbindungen</th></tr>' +
  HEADER +
  row('Corps Verschollen', '1850', 'rot-weiß', 'KSCV', 'pflichtschlagend') +
  '</tbody></table>' +
  heading(2, 'Ehemalige Verbindungen') +
  '<table class="wikitable"><tbody>' +
  HEADER +
  row('Corps Aufgelöst', '1900', 'grün-weiß', 'WSC', 'pflichtschlagend') +
  '</tbody></table>' +
  heading(2, 'Schülerverbindungen') +
  '<table class="wikitable"><tbody>' +
  HEADER +
  row('Schülerverbindung Test', '1960', 'blau-weiß', 'verbandsfrei', '') +
  '</tbody></table>' +
  navbox +
  '</div>';

const simpleHeader =
  '<tr><th>Name</th><th>Gründung</th><th>Farben</th><th>Verband</th><th>Fechtfrage</th></tr>';

const simpleList = (rows: string[]) =>
  '<div class="mw-parser-output">' +
  heading(2, 'Aktive Verbindungen') +
  `<table class="wikitable"><tbody>${simpleHeader}${rows.join(
    '',
  )}</tbody></table></div>`;

const simpleRow = (cells: string[]) =>
  `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;

export const wienHtml = simpleList([
  simpleRow([
    link('KÖStV Babenberg Wien', 'KÖStV Babenberg'),
    '1. Juli 1960',
    'rot-weiß-gold',
    link('Österreichischer Cartellverband', 'ÖCV'),
    'nichtschlagend',
  ]),
]);

export const bernHtml = simpleList([
  simpleRow([
    'AV Rhenania Bern',
    '1874',
    'rot-weiß-grün',
    'STV',
    'pflichtschlagend',
  ]),
]);

export const koblenzHtml = simpleList([
  simpleRow(['KDStV Rhenania Koblenz', '1950', 'schwarz-weiß-gold', 'CV', '']),
]);

// A list of an association, with a column for the city. Its headers contain soft hyphens, like the real ones.
export const burschenschaftenHtml =
  '<div class="mw-parser-output">' +
  heading(2, 'Aktive Burschenschaften') +
  '<table class="wikitable"><tbody>' +
  '<tr><th>Name</th><th>Sitz</th><th>Gründung</th><th>Farben</th><th>Ver&shy;band</th><th>Fechtfrage</th><th>Sta&shy;tus</th></tr>' +
  simpleRow([
    link('Aachener Burschenschaft Teutonia'),
    'Aachen',
    '1899',
    'schwarz-weinrot-gold',
    'ADB',
    'fakultativ schlagend',
    'aktiv',
  ]) +
  simpleRow([
    'Burschenschaft Libertas Wien',
    'Wien, Österreich',
    '1892',
    'schwarz-rot-gold',
    'DB',
    'pflichtschlagend',
    'aktiv',
  ]) +
  simpleRow([
    'Burschenschaft Fernweh',
    'Riga',
    '1900',
    'blau-weiß',
    'DB',
    '',
    'aktiv',
  ]) +
  simpleRow([
    'Burschenschaft Ruhend',
    'Aachen',
    '1951',
    'schwarz-gold',
    'RKDB',
    'nichtschlagend',
    'inaktiv',
  ]) +
  '</tbody></table></div>';

export const pages: Record<string, string> = {
  'Liste der Studentenverbindungen in Aachen': aachenHtml,
  'Liste der Studenten- und Schülerverbindungen in Wien': wienHtml,
  'Liste der Studentenverbindungen in Bern': bernHtml,
  'Liste der Studentenverbindungen in Koblenz und Vallendar': koblenzHtml,
  'Liste der Burschenschaften': burschenschaftenHtml,
};

export const indexLinks = [
  {ns: 0, title: 'Liste der Studentenverbindungen in Aachen', exists: true},
  {
    ns: 0,
    title: 'Liste der Studenten- und Schülerverbindungen in Wien',
    exists: true,
  },
  {ns: 0, title: 'Liste der Studentenverbindungen in Bern', exists: true},
  {
    ns: 0,
    title: 'Liste der Studentenverbindungen in Koblenz und Vallendar',
    exists: true,
  },
  {ns: 0, title: 'Liste der Studentenverbindungen in Nirgendwo', exists: false},
  {ns: 0, title: 'Liste der Burschenschaften', exists: true},
  {ns: 0, title: 'Alemannia (Studentenverbindung)', exists: true},
  {ns: 14, title: 'Kategorie:Liste (Studentenverbindungen)', exists: true},
  // The same list linked twice, as happens in navigation boxes
  {ns: 0, title: 'Liste der Studentenverbindungen in Aachen', exists: true},
];

/** Coordinates of articles, by the title Wikipedia knows them by */
export const coordinatesOfArticles: Record<string, {lat: number; lon: number}> =
  {
    'Corps Saxo-Montania zu Freiberg und Dresden in Aachen': {
      lat: 50.7751,
      lon: 6.0801,
    },
    'Burschenschaft Teutonia Aachen': {lat: 50.7712, lon: 6.0723},
  };

/**
 * A stand-in for the API of Wikipedia that answers from the fixtures and records what it was asked
 */
export const createFakeWikipedia = (
  options: {failPages?: string[]; pages?: Record<string, string>} = {},
) => {
  const requests: URL[] = [];
  const headers: Record<string, string>[] = [];

  const fetchImpl = jest.fn(
    async (url: string, init?: {headers?: Record<string, string>}) => {
      const parsed = new URL(url);
      requests.push(parsed);
      headers.push(init?.headers ?? {});
      const q = parsed.searchParams;
      const respond = (body: unknown) => ({
        ok: true,
        status: 200,
        headers: {get: () => null},
        json: async () => body,
      });

      if (q.get('action') === 'parse' && q.get('prop') === 'links') {
        return respond({parse: {title: q.get('page'), links: indexLinks}});
      }

      if (q.get('action') === 'parse' && q.get('prop') === 'text') {
        const page = q.get('page') as string;
        if (options.failPages?.includes(page)) {
          return respond({
            error: {
              code: 'missingtitle',
              info: "The page you specified doesn't exist.",
            },
          });
        }
        return respond({
          parse: {
            title: page,
            text: (options.pages ?? pages)[page] ?? '<p>Leer</p>',
          },
        });
      }

      if (q.get('action') === 'query' && q.get('prop') === 'coordinates') {
        const asked = (q.get('titles') as string).split('|');
        const redirects = asked
          .filter(t => t === 'Aachener Burschenschaft Teutonia')
          .map(from => ({from, to: 'Burschenschaft Teutonia Aachen'}));
        const articles = asked.map(title => {
          const resolved = redirects.find(r => r.from === title)?.to ?? title;
          const coordinates = coordinatesOfArticles[resolved];
          return {
            pageid: 1,
            ns: 0,
            title: resolved,
            ...(coordinates
              ? {coordinates: [{...coordinates, primary: true, globe: 'earth'}]}
              : {}),
          };
        });
        return respond({query: {redirects, pages: articles}});
      }

      return {
        ok: false,
        status: 400,
        headers: {get: () => null},
        json: async () => ({}),
      };
    },
  );

  return {fetchImpl, requests, headers};
};
