import fs from 'fs';
import os from 'os';
import path from 'path';

import {CouleurbummelModel} from '../../src/model/model';
import {parseDatabase} from '../../src/model/validation';
import {
  buildDatabase,
  CORPORATION_COLUMNS,
  readTable,
  resolveColour,
  stringifyCsv,
} from '../../tools/build-database/build-database';
import {
  APPROXIMATE_COLOUR_WORDS,
  cityOfTitle,
  COLOUR_WORDS,
  countryOfCity,
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
} from '../../tools/wikipedia-import/wikipedia-import';
import {
  aachenHtml,
  burschenschaftenHtml,
  createFakeWikipedia,
  indexLinks,
} from '../__helpers__/wikipedia-fixtures';

const noWait = (_ms?: number) => Promise.resolve();

describe('HTML', () => {
  it('reads text the way a reader sees it', () => {
    const root = parseHtml(
      '<p>Ver&shy;band &amp; M&auml;nner&nbsp;<b>fett</b><br />neu<sup class="reference"><a href="#c">[1]</a></sup>' +
        '<span class="mw-editsection">[bearbeiten]</span>&#8211;&#x2013;</p>',
    );

    expect(textOf(root)).toBe('Verband & Männer fett neu––');
  });

  it('skips styles and scripts, even if they contain something that looks like a tag', () => {
    const root = parseHtml(
      '<div>vor<style>a > b { content: "<td>" }</style><script>if (a < b) {}</script>nach</div>',
    );

    expect(textOf(root)).toBe('vornach');
  });

  it('understands attributes in all their forms', () => {
    const root = parseHtml(
      `<table class="wikitable sortable"><tr><td colspan=2 data-x='a "b"' hidden>x</td></tr></table>`,
    );
    const td = root.children[0].children[0].children[0];

    expect(td.attrs).toEqual({colspan: '2', 'data-x': 'a "b"', hidden: ''});
  });

  it('copes with omitted end tags in tables', () => {
    const tables = extractTables(
      parseHtml(
        '<table><tr><th>Name<th>Gründung<tr><td>A<td>1900<tr><td>B<td>1901</table>',
      ),
    );

    expect(tables[0].grid.map(r => r.map(c => c.text))).toEqual([
      ['Name', 'Gründung'],
      ['A', '1900'],
      ['B', '1901'],
    ]);
  });
});

describe('tables', () => {
  it('lets cells span rows and columns', () => {
    const [{grid}] = extractTables(
      parseHtml(
        '<table><tr><td rowspan="2">A</td><td>B</td><td>C</td></tr>' +
          '<tr><td colspan="2">D</td></tr>' +
          '<tr><td>E</td><td>F</td><td>G</td></tr></table>',
      ),
    );

    expect(grid.map(r => r.map(c => c.text))).toEqual([
      ['A', 'B', 'C'],
      ['A', 'D', 'D'],
      ['E', 'F', 'G'],
    ]);
    expect(grid[1][1]).toBe(grid[1][2]);
  });

  it('knows which headings a table is under', () => {
    const tables = extractTables(
      parseHtml(
        '<h2>Erste</h2><h3>Unter</h3><table><tr><td>1</td></tr></table>' +
          '<h3>Zweite Unter</h3><table><tr><td>2</td></tr></table>' +
          '<h2>Zweite</h2><table><tr><td>3</td></tr></table>',
      ),
    );

    expect(tables.map(t => t.sections)).toEqual([
      ['Erste', 'Unter'],
      ['Erste', 'Zweite Unter'],
      ['Zweite'],
    ]);
  });

  it('keeps links to existing articles only', () => {
    const [{grid}] = extractTables(
      parseHtml(
        '<table><tr><td>' +
          '<a href="/wiki/Corps_Delta_(Aachen)" title="Corps Delta (Aachen)">Delta</a>' +
          '<a href="/w/index.php?title=X&amp;redlink=1" class="new" title="X (Seite nicht vorhanden)">X</a>' +
          '<a href="/wiki/Datei:Bild.jpg">Bild</a><a href="https://example.org">extern</a>' +
          '<sup class="reference"><a href="/wiki/Fussnote">1</a></sup>' +
          '</td></tr></table>',
      ),
    );

    expect(grid[0][0].links).toEqual([
      {
        text: 'Delta',
        title: 'Corps Delta (Aachen)',
        target: 'Corps Delta (Aachen)',
      },
    ]);
  });
});

describe('foundation dates', () => {
  it.each([
    ['1819', '1819'],
    ['1. Juli 1960', '1960-07-01'],
    ['14. Jan. 1861', '1861-01-14'],
    ['27. Jan. 1920', '1920-01-27'],
    ['3. März 1850', '1850-03-03'],
    ['9. Dez. 2001', '2001-12-09'],
    ['1798/1873', '1798'],
    ['gegründet 1904[3]', '1904'],
    ['', ''],
    ['unbekannt', ''],
  ])('reads %p as %p', (text, expected) => {
    expect(parseFoundation(text)).toBe(expected);
  });
});

describe('colours', () => {
  it('turns German colour words into the colours of the palette', () => {
    expect(parseColours('blau-weiß-gold').colours).toBe('blue-white-gold');
    expect(parseColours('hellblau-weiß-gold').colours).toBe(
      'blue_light-white-gold',
    );
    expect(parseColours('orange-weiß-moosgrün').colours).toBe(
      'orange-white-green_moss',
    );
    expect(parseColours('silber-schwarz-gold').colours).toBe(
      'silver-black-gold',
    );
    expect(parseColours('schwarz-dunkelrot-gold').colours).toBe(
      'black-red_dark-gold',
    );
  });

  it('reverses colours that are listed from the bottom up', () => {
    expect(parseColours('schwarz-weinrot-gold (v.u.)').colours).toBe(
      'gold-red_wine-black',
    );
    expect(parseColours('schwarz-rot-gold (v. u.)').colours).toBe(
      'gold-red-black',
    );
  });

  it('accepts dashes of all kinds, spaces and several sashes', () => {
    expect(parseColours('rot–weiß – gold').colours).toBe('red-white-gold');
    expect(parseColours('rot-weiß; blau-gold').colours).toBe(
      'red-white|blue-gold',
    );
    expect(parseColours('rot-weiß bzw. grün-weiß').colours).toBe(
      'red-white|green-white',
    );
  });

  it('ignores other remarks in brackets, and reports them', () => {
    const result = parseColours('schwarz-gold (Burschenband)');

    expect(result.colours).toBe('black-gold');
    expect(result.annotations).toEqual(['Burschenband']);
  });

  it('reads "(f.f.)", farbenführend, as colours that are not worn', () => {
    const result = parseColours('schwarz-gold (f.f.)');

    expect(result).toMatchObject({
      colours: 'black-gold',
      principle: 3,
      annotations: [],
    });
    expect(parseColours('schwarz-gold (f. f.)').principle).toBe(3);
  });

  it('takes colours without that remark to be worn, as the lists say, and none to mean unknown', () => {
    expect(parseColours('schwarz-gold').principle).toBe(5);
    // Even if the colours themselves can't be read, they are worn
    expect(parseColours('schwarz-türkis').principle).toBe(5);
    expect(parseColours('').principle).toBe(0);
    expect(parseColours('—').principle).toBe(0);
  });

  it('reads the base colour from "auf weißem Grund"', () => {
    expect(parseColours('blau-weiß-orange auf weißem Grund')).toMatchObject({
      colours: 'blue-white-orange@white',
      unknown: [],
    });
    expect(parseColours('rot-gold auf schwarzem Untergrund').colours).toBe(
      'red-gold@black',
    );
  });

  it('reads a percussion', () => {
    expect(parseColours('rot-weiß-gold mit goldener Perkussion').colours).toBe(
      'red-white-gold+gold',
    );
    expect(parseColours('rot-weiß-gold, Perkussion silber').colours).toBe(
      'red-white-gold+silver',
    );
    expect(
      parseColours('rot-weiß auf schwarzem Grund mit silberner Perkussion')
        .colours,
    ).toBe('red-white@black+silver');
  });

  it('reads adjective endings of colour words', () => {
    expect(parseColours('blaue-weiße-rote').colours).toBe('blue-white-red');
  });

  it('reads the colours that were found on the real list of Aachen', () => {
    const coal = parseColours('silber-kohle-gold (f.f.)');
    expect(coal).toMatchObject({
      colours: 'silver-black-gold',
      principle: 3,
      approximated: ['kohle'],
      unknown: [],
    });
    expect(parseColours('schwarz-blassrot-weiß').colours).toBe(
      'black-red-white',
    );
  });

  it('gives up if a word of the sash cannot be read, but still reports all of them', () => {
    const result = parseColours(
      'rot-türkis-weiß-lachs auf magentafarbenem Grund',
    );

    expect(result.colours).toBe('');
    expect(result.unknown).toEqual(['tuerkis', 'lachs', 'magentafarbenem']);
  });

  it('only uses colours that the builder has in its palette', () => {
    for (const name of [
      ...Object.values(COLOUR_WORDS),
      ...Object.values(APPROXIMATE_COLOUR_WORDS),
    ]) {
      expect(() => resolveColour(name)).not.toThrow();
    }
  });

  it('replaces shades the palette lacks by the closest colour, and says so', () => {
    const result = parseColours('schwarz-blassrot-weiß');

    expect(result.colours).toBe('black-red-white');
    expect(result.approximated).toEqual(['blassrot']);
    expect(parseColours('schwarz-altgold-weiß').colours).toBe(
      'black-gold-white',
    );
    expect(parseColours('tiefschwarz-weiß').approximated).toEqual([
      'tiefschwarz',
    ]);
  });

  it('gives up on colours it cannot read rather than guess', () => {
    const result = parseColours('rot-türkis-weiß');

    expect(result.colours).toBe('');
    expect(result.unknown).toEqual(['tuerkis']);
  });

  it('only ever produces colours that the database builder knows', async () => {
    const words = [
      'schwarz-weiß-rot',
      'hellblau-gold',
      'blassrot-moosgrün-altgold',
      'bordeaux-karmesin-lila',
      'blau-weiß-orange auf weißem Grund',
      'silber-kohle-gold (f.f.)',
      'rot-weiß-gold mit goldener Perkussion',
    ];
    const csv = stringifyCsv(
      CORPORATION_COLUMNS,
      words.map((w, i) => ({
        shortName: `Corps ${i}`,
        city: 'X',
        country: 'DE',
        latitude: '50',
        longitude: '6',
        colours: parseColours(w).colours,
      })),
    );

    const {errors} = await buildDatabase({corporationsCsv: csv});

    expect(errors).toEqual([]);
  });

  it('is empty if there are no colours', () => {
    expect(parseColours('').colours).toBe('');
    expect(parseColours('—').colours).toBe('');
  });
});

describe('fencing principles', () => {
  it.each([
    ['pflichtschlagend', 4],
    ['Pflichtschlagend', 4],
    ['fakultativ schlagend', 2],
    ['fakultativ', 2],
    ['nichtschlagend', 1],
    ['nicht schlagend', 1],
    ['freischlagend', 2],
    ['Freischlagend', 2],
    ['pflichtfechtend', 3],
    ['', 0],
  ])('reads %p as %p', (text, value) => {
    expect(parseFencing(text)).toEqual({value, known: true});
  });

  it('says when it does not understand', () => {
    expect(parseFencing('manchmal')).toEqual({value: 0, known: false});
  });
});

describe('organisations', () => {
  const cell = (text: string, links: {text: string; title: string}[] = []) => ({
    text,
    links: links.map(l => ({...l, target: l.title})),
  });

  it('reads several associations and the names that their links give', () => {
    const result = parseOrganisations(
      cell('KSCV, WSC', [
        {text: 'KSCV', title: 'Kösener Senioren-Convents-Verband'},
        {text: 'WSC', title: 'WSC'},
      ]),
    );

    expect(result.abbreviations).toEqual(['KSCV', 'WSC']);
    expect([...result.names]).toEqual([
      ['KSCV', 'Kösener Senioren-Convents-Verband'],
    ]);
  });

  it.each([
    ['verbandsfrei', []],
    ['—', []],
    ['', []],
    ['CV und KV', ['CV', 'KV']],
    ['CV/KV (Ehrenmitglied)', ['CV', 'KV']],
  ])('reads %p as %p', (text, abbreviations) => {
    expect(parseOrganisations(cell(text)).abbreviations).toEqual(abbreviations);
  });
});

describe('lists', () => {
  it.each([
    ['Liste der Studentenverbindungen in Aachen', 'Aachen'],
    ['Liste der Studenten- und Schülerverbindungen in Würzburg', 'Würzburg'],
    ['Liste der Studentenverbindungen in Frankfurt (Oder)', 'Frankfurt (Oder)'],
    ['Liste der Studentenverbindungen in St. Gallen', 'St. Gallen'],
    ['Liste der Burschenschaften', undefined],
    ['Alemannia (Studentenverbindung)', undefined],
  ])('finds the city in %p', (title, city) => {
    expect(cityOfTitle(title)).toBe(city);
  });

  it('knows the countries of the cities that the list of lists files under Austria and Switzerland', () => {
    expect(countryOfCity('Wien')).toBe('AT');
    expect(countryOfCity('Innsbruck')).toBe('AT');
    expect(countryOfCity('Zürich')).toBe('CH');
    expect(countryOfCity('St. Gallen')).toBe('CH');
    expect(countryOfCity('Aachen')).toBe('DE');
  });

  it('lets the user correct the country', () => {
    const overrides = new Map([
      ['bern', 'DE'],
      ['neustadt', 'AT'],
    ]);

    expect(countryOfCity('Bern', overrides)).toBe('DE');
    expect(countryOfCity('Neustadt', overrides)).toBe('AT');
  });

  it('selects the lists of cities, once each, and only those that exist', () => {
    expect(selectLists(indexLinks).map(l => l.title)).toEqual([
      'Liste der Studentenverbindungen in Aachen',
      'Liste der Studenten- und Schülerverbindungen in Wien',
      'Liste der Studentenverbindungen in Bern',
      'Liste der Studentenverbindungen in Koblenz und Vallendar',
    ]);
  });

  it('selects by city and adds further lists on request', () => {
    expect(
      selectLists(indexLinks, {cities: ['aachen', 'Vallendar']}).map(
        l => l.city,
      ),
    ).toEqual(['Aachen', 'Koblenz und Vallendar']);
    expect(
      selectLists(indexLinks, {
        cities: ['Bern'],
        lists: /Burschenschaften/,
      }).map(l => l.title),
    ).toEqual([
      'Liste der Studentenverbindungen in Bern',
      'Liste der Burschenschaften',
    ]);
  });
});

describe('parseListPage', () => {
  const {records, left} = parseListPage(aachenHtml);

  it('reads the active corporations with everything that was in their row', () => {
    expect(records.map(r => r.name)).toEqual([
      'Corps Saxo-Montania',
      'Corps Borussia Breslau zu Köln und Aachen',
      'Corps Delta',
      'Aachener Burschenschaft Teutonia',
      'Danziger Burschenschaft Alemannia',
      'Akademischer Verein Test',
    ]);

    expect(records[0]).toMatchObject({
      foundation: '1798',
      colours: 'blau-weiß-gold',
      fencing: 'pflichtschlagend',
      target: 'Corps Saxo-Montania zu Freiberg und Dresden in Aachen',
    });
    expect(records[0].verband?.text).toBe('WSC');
  });

  it('leaves out footnote marks and links to articles that do not exist', () => {
    expect(records[1].target).toBeUndefined();
    expect(records[2].name).toBe('Corps Delta');
  });

  it('gives a corporation the association that spans its row and the next', () => {
    expect(records[1].verband?.text).toBe('KSCV, WSC');
    expect(records[2].verband?.text).toBe('KSCV, WSC');
  });

  it('sets inactive corporations and school fraternities aside', () => {
    expect(left.inactive.map(r => r.name)).toEqual([
      'Corps Verschollen',
      'Corps Aufgelöst',
    ]);
    expect(left.pupil.map(r => r.name)).toEqual(['Schülerverbindung Test']);
  });

  it('ignores tables that are not lists of corporations, and repeated header rows', () => {
    expect(left.tables).toBe(3);
    expect(records.map(r => r.name)).not.toContain('Name');
    expect(records.map(r => r.name)).not.toContain('Listen');
  });

  it('finds the city column and the headers despite soft hyphens', () => {
    const page = parseListPage(burschenschaftenHtml);

    expect(page.records.map(r => [r.name, r.sitz, r.verband?.text])).toEqual([
      ['Aachener Burschenschaft Teutonia', 'Aachen', 'ADB'],
      ['Burschenschaft Libertas Wien', 'Wien, Österreich', 'DB'],
      ['Burschenschaft Fernweh', 'Riga', 'DB'],
    ]);
    expect(page.left.inactive.map(r => r.name)).toEqual([
      'Burschenschaft Ruhend',
    ]);
  });

  it('finds nothing in a page without such a table', () => {
    expect(parseListPage('<p>Keine Tabelle</p>')).toEqual({
      records: [],
      left: {inactive: [], pupil: [], tables: 0},
    });
  });
});

describe('createClient', () => {
  it('identifies itself, asks politely and reads what Wikipedia answers', async () => {
    const wiki = createFakeWikipedia();
    const wait = jest.fn(noWait);
    const client = createClient({
      userAgent: 'agent/1.0 (me@example.org)',
      fetchImpl: wiki.fetchImpl as unknown as typeof fetch,
      wait,
    });

    const links = await client.links(
      'Liste der Listen von Studentenverbindungen',
    );
    const html = await client.html('Liste der Studentenverbindungen in Bern');

    expect(links).toHaveLength(indexLinks.length);
    expect(html).toContain('AV Rhenania Bern');
    expect(wiki.headers[0]).toEqual({
      'User-Agent': 'agent/1.0 (me@example.org)',
      Accept: 'application/json',
    });
    expect(wait).toHaveBeenCalledTimes(2);

    const [linksUrl, htmlUrl] = wiki.requests;
    expect(linksUrl.origin + linksUrl.pathname).toBe(
      'https://de.wikipedia.org/w/api.php',
    );
    expect(Object.fromEntries(linksUrl.searchParams)).toEqual({
      action: 'parse',
      page: 'Liste der Listen von Studentenverbindungen',
      prop: 'links',
      redirects: '1',
      format: 'json',
      formatversion: '2',
    });
    expect(htmlUrl.searchParams.get('prop')).toBe('text');
    expect(htmlUrl.searchParams.get('disableeditsection')).toBe('1');
  });

  it('maps the coordinates of articles to the titles that were asked for, across redirects', async () => {
    const wiki = createFakeWikipedia();
    const client = createClient({
      userAgent: 'agent',
      fetchImpl: wiki.fetchImpl as unknown as typeof fetch,
      wait: noWait,
    });

    const found = await client.coordinates([
      'Corps Saxo-Montania zu Freiberg und Dresden in Aachen',
      'Aachener Burschenschaft Teutonia',
      'Artikel ohne Koordinaten',
    ]);

    expect([...found]).toEqual([
      [
        'Corps Saxo-Montania zu Freiberg und Dresden in Aachen',
        {latitude: 50.7751, longitude: 6.0801},
      ],
      [
        'Aachener Burschenschaft Teutonia',
        {latitude: 50.7712, longitude: 6.0723},
      ],
    ]);
    const url = wiki.requests[0];
    expect(url.searchParams.get('titles')).toBe(
      'Corps Saxo-Montania zu Freiberg und Dresden in Aachen|Aachener Burschenschaft Teutonia|Artikel ohne Koordinaten',
    );
    expect(url.searchParams.get('coprimary')).toBe('primary');
    expect(url.searchParams.get('colimit')).toBe('max');
  });

  it('reports errors that Wikipedia returns', async () => {
    const wiki = createFakeWikipedia({failPages: ['Fehlt']});
    const client = createClient({
      userAgent: 'agent',
      fetchImpl: wiki.fetchImpl as unknown as typeof fetch,
      wait: noWait,
    });

    await expect(client.html('Fehlt')).rejects.toThrow(
      "missingtitle: The page you specified doesn't exist.",
    );
  });

  it('waits as long as it is told and tries again when it is asked to slow down', async () => {
    const answer = (status: number, retryAfter: string | null) => ({
      ok: status === 200,
      status,
      headers: {
        get: (name: string) => (name === 'retry-after' ? retryAfter : null),
      },
      json: async () => ({parse: {links: [{ns: 0, title: 'X'}]}}),
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(answer(429, '7'))
      .mockResolvedValueOnce(answer(503, null))
      .mockResolvedValueOnce(answer(200, null));
    const wait = jest.fn(noWait);
    const client = createClient({
      userAgent: 'agent',
      fetchImpl,
      wait,
      delayMs: 10,
    });

    expect(await client.links('Seite')).toEqual([{ns: 0, title: 'X'}]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(c => c[0])).toEqual([10, 7000, 10, 5000, 10]);
  });

  it('gives up after a few attempts, and on other failures', async () => {
    const refuse = (status: number) => ({
      ok: false,
      status,
      headers: {get: () => null},
      json: async () => ({}),
    });

    const throttled = jest.fn().mockResolvedValue(refuse(429));
    await expect(
      createClient({
        userAgent: 'agent',
        fetchImpl: throttled,
        wait: noWait,
      }).links('Seite'),
    ).rejects.toThrow('status 429');
    expect(throttled).toHaveBeenCalledTimes(4);

    const broken = jest.fn().mockResolvedValue(refuse(500));
    await expect(
      createClient({userAgent: 'agent', fetchImpl: broken, wait: noWait}).links(
        'Seite',
      ),
    ).rejects.toThrow('status 500');
    expect(broken).toHaveBeenCalledTimes(1);
  });

  describe('with a directory for answers', () => {
    let cacheDir: string;
    beforeEach(() => {
      cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikipedia-cache-'));
    });
    afterEach(() => {
      fs.rmSync(cacheDir, {recursive: true, force: true});
    });

    it('does not ask the same thing twice, unless told to', async () => {
      const wiki = createFakeWikipedia();
      const make = (refresh = false) =>
        createClient({
          userAgent: 'agent',
          fetchImpl: wiki.fetchImpl as unknown as typeof fetch,
          wait: noWait,
          cacheDir,
          refresh,
        });

      await make().html('Liste der Studentenverbindungen in Bern');
      const again = await make().html(
        'Liste der Studentenverbindungen in Bern',
      );
      await make().html('Liste der Studentenverbindungen in Aachen');

      expect(again).toContain('AV Rhenania Bern');
      expect(wiki.fetchImpl).toHaveBeenCalledTimes(2);
      expect(fs.readdirSync(cacheDir)).toHaveLength(2);

      await make(true).html('Liste der Studentenverbindungen in Bern');
      expect(wiki.fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('does not keep errors', async () => {
      const wiki = createFakeWikipedia({failPages: ['Fehlt']});
      const client = createClient({
        userAgent: 'agent',
        fetchImpl: wiki.fetchImpl as unknown as typeof fetch,
        wait: noWait,
        cacheDir,
      });

      await expect(client.html('Fehlt')).rejects.toThrow();

      expect(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []).toEqual(
        [],
      );
    });
  });
});

describe('importFromWikipedia', () => {
  const run = (options = {}, fake = createFakeWikipedia()) => {
    const client = createClient({
      userAgent: 'agent',
      fetchImpl: fake.fetchImpl as unknown as typeof fetch,
      wait: noWait,
    });
    return importFromWikipedia(client, options);
  };
  const byName = (rows: Record<string, any>[], name: string) =>
    rows.find(r => r.shortName === name)!;

  it('collects the corporations of the lists of the cities', async () => {
    const {rows, stats} = await run();

    expect(rows.map(r => [r.shortName, r.city, r.country])).toEqual([
      ['Corps Saxo-Montania', 'Aachen', 'DE'],
      ['Corps Borussia Breslau zu Köln und Aachen', 'Aachen', 'DE'],
      ['Corps Delta', 'Aachen', 'DE'],
      ['Aachener Burschenschaft Teutonia', 'Aachen', 'DE'],
      ['Danziger Burschenschaft Alemannia', 'Aachen', 'DE'],
      ['Akademischer Verein Test', 'Aachen', 'DE'],
      ['KÖStV Babenberg', 'Wien', 'AT'],
      ['AV Rhenania Bern', 'Bern', 'CH'],
      ['KDStV Rhenania Koblenz', 'Koblenz', 'DE'],
    ]);
    expect(stats).toMatchObject({
      lists: 4,
      corporations: 9,
      inactive: 2,
      pupil: 1,
    });
  });

  it('turns the columns into the fields of the corporations file', async () => {
    const {rows} = await run();

    expect(byName(rows, 'Corps Saxo-Montania')).toMatchObject({
      longName: 'Corps Saxo-Montania',
      foundationDate: '1798',
      colours: 'blue-white-gold',
      organisations: 'WSC',
      fencingPrinciple: 4,
      hidden: '',
    });
    expect(byName(rows, 'Corps Delta')).toMatchObject({
      colours: 'white-red-gold',
      organisations: 'KSCV|WSC',
    });
    expect(byName(rows, 'Aachener Burschenschaft Teutonia')).toMatchObject({
      colours: 'gold-red_wine-black',
      fencingPrinciple: 2,
    });
    expect(
      byName(rows, 'Danziger Burschenschaft Alemannia').foundationDate,
    ).toBe('1920-01-27');
    expect(byName(rows, 'Akademischer Verein Test')).toMatchObject({
      organisations: '',
      fencingPrinciple: '',
      colours: 'black-gold',
      coloursPrinciple: 3,
    });
    expect(byName(rows, 'Corps Saxo-Montania').coloursPrinciple).toBe(5);
    expect(byName(rows, 'KÖStV Babenberg')).toMatchObject({
      foundationDate: '1960-07-01',
      fencingPrinciple: 1,
    });
  });

  it('collects the organisations with the names that the links give', async () => {
    const {organisations} = await run();

    expect(organisations).toEqual([
      {abbreviation: 'ADB', name: 'Allgemeiner Deutscher Burschenbund'},
      {abbreviation: 'CV', name: 'CV'},
      {abbreviation: 'KSCV', name: 'Kösener Senioren-Convents-Verband'},
      {abbreviation: 'NDB', name: 'NDB'},
      {abbreviation: 'ÖCV', name: 'Österreichischer Cartellverband'},
      {abbreviation: 'STV', name: 'STV'},
      {abbreviation: 'WSC', name: 'Weinheimer Senioren-Convent'},
    ]);
  });

  it('warns about shades it replaced and about cities that need a look', async () => {
    const {warnings} = await run();

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          '"Corps Borussia Breslau zu Köln und Aachen": replaced blassrot',
        ),
        expect.stringContaining(
          '"KDStV Rhenania Koblenz" is placed in Koblenz; the list covers Koblenz und Vallendar',
        ),
      ]),
    );
  });

  it('keeps inactive corporations as hidden, and school fraternities, when asked', async () => {
    const {rows} = await run({includeInactive: true, includePupil: true});

    expect(byName(rows, 'Corps Verschollen').hidden).toBe('yes');
    expect(byName(rows, 'Corps Aufgelöst').hidden).toBe('yes');
    expect(byName(rows, 'Schülerverbindung Test')).toBeDefined();
    expect(byName(rows, 'Corps Delta').hidden).toBe('');
  });

  it('only reads the lists of the cities that were asked for', async () => {
    const fake = createFakeWikipedia();

    const {rows} = await run({cities: ['Bern', 'wien']}, fake);

    expect(rows.map(r => r.city)).toEqual(['Wien', 'Bern']);
    const pagesRead = fake.requests
      .filter(r => r.searchParams.get('prop') === 'text')
      .map(r => r.searchParams.get('page'));
    expect(pagesRead).toEqual([
      'Liste der Studenten- und Schülerverbindungen in Wien',
      'Liste der Studentenverbindungen in Bern',
    ]);
  });

  it('uses the countries it is given', async () => {
    const {rows} = await run({
      cities: ['Bern'],
      countries: new Map([['bern', 'DE']]),
    });

    expect(rows[0].country).toBe('DE');
  });

  it('only shows the lists, if asked', async () => {
    const fake = createFakeWikipedia();

    const result = await run({listOnly: true}, fake);

    expect(result.lists.map(l => [l.country, l.city])).toEqual([
      ['DE', 'Aachen'],
      ['AT', 'Wien'],
      ['CH', 'Bern'],
      ['DE', 'Koblenz und Vallendar'],
    ]);
    expect(fake.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('can limit the number of lists', async () => {
    const {stats} = await run({limit: 2});

    expect(stats.lists).toBe(2);
  });

  it('reads further lists, takes the city from them, and merges what is in both lists', async () => {
    const {rows, stats, warnings} = await run({
      cities: ['Aachen'],
      lists: /Burschenschaften/,
    });

    expect(stats.duplicates).toBe(1);
    expect(
      rows.filter(r => r.shortName === 'Aachener Burschenschaft Teutonia'),
    ).toHaveLength(1);
    expect(byName(rows, 'Burschenschaft Libertas Wien')).toMatchObject({
      city: 'Wien',
      country: 'AT',
    });
    expect(byName(rows, 'Burschenschaft Fernweh')).toMatchObject({
      city: 'Riga',
      country: 'DE',
    });
    expect(warnings).toContain(
      'The country of Riga isn\'t known, so Germany was assumed. Correct it with --country "City=XX".',
    );
  });

  it('takes coordinates from the articles of the corporations, if asked', async () => {
    const fake = createFakeWikipedia();

    const {rows, stats} = await run(
      {cities: ['Aachen'], coordinates: true},
      fake,
    );

    expect(byName(rows, 'Corps Saxo-Montania')).toMatchObject({
      latitude: 50.7751,
      longitude: 6.0801,
    });
    expect(byName(rows, 'Aachener Burschenschaft Teutonia')).toMatchObject({
      latitude: 50.7712,
      longitude: 6.0723,
    });
    expect(byName(rows, 'Corps Delta').latitude).toBeUndefined();
    expect(stats.withCoordinates).toBe(2);

    // Only articles that exist are asked for
    const asked = fake.requests
      .filter(r => r.searchParams.get('prop') === 'coordinates')
      .flatMap(r => r.searchParams.get('titles')!.split('|'));
    expect(asked.sort()).toEqual([
      'Aachener Burschenschaft Teutonia',
      'Corps Saxo-Montania zu Freiberg und Dresden in Aachen',
    ]);
  });

  it('does not look at coordinates unless asked', async () => {
    const fake = createFakeWikipedia();

    await run({cities: ['Aachen']}, fake);

    expect(
      fake.requests.some(r => r.searchParams.get('prop') === 'coordinates'),
    ).toBe(false);
  });

  it('asks for coordinates 50 articles at a time', async () => {
    const rows = Array.from(
      {length: 120},
      (_, i) =>
        `<tr><td><a href="/wiki/Corps_${i}" title="Corps ${i}">Corps ${i}</a></td><td>1900</td><td>rot-weiß</td><td>CV</td><td></td></tr>`,
    ).join('');
    const fake = createFakeWikipedia({
      pages: {
        'Liste der Studentenverbindungen in Aachen': `<table><tr><th>Name</th><th>Gründung</th><th>Farben</th><th>Verband</th><th>Fechtfrage</th></tr>${rows}</table>`,
      },
    });

    await run({cities: ['Aachen'], coordinates: true}, fake);

    const batches = fake.requests
      .filter(r => r.searchParams.get('prop') === 'coordinates')
      .map(r => r.searchParams.get('titles')!.split('|').length);
    expect(batches).toEqual([50, 50, 20]);
  });

  it('carries on if a list cannot be read, and says so', async () => {
    const fake = createFakeWikipedia({
      failPages: ['Liste der Studentenverbindungen in Bern'],
    });

    const {rows, warnings} = await run({}, fake);

    expect(rows.map(r => r.city)).not.toContain('Bern');
    expect(rows.map(r => r.city)).toContain('Wien');
    expect(warnings).toContain(
      "Liste der Studentenverbindungen in Bern: couldn't be read (missingtitle: The page you specified doesn't exist.)",
    );
  });

  it('warns if a page has no table of corporations, which means the layout changed', async () => {
    const fake = createFakeWikipedia({
      pages: {'Liste der Studentenverbindungen in Bern': '<p>Nur Text</p>'},
    });

    const {warnings} = await run({cities: ['Bern']}, fake);

    expect(warnings).toEqual([
      expect.stringMatching(/Bern: no table of corporations was found/),
    ]);
  });

  it('writes a report', async () => {
    const {report} = await run({coordinates: true, cities: ['Aachen']});

    expect(report).toContain('Corporations: 6');
    expect(report).toContain('Left out: 2 inactive, 1 school fraternities');
    expect(report).toContain('Coordinates from articles: 2');
    expect(report).toContain('Corporations still without coordinates: 4');
    expect(report).toMatch(/Other remarks[^\n]*\n {2}none/);
    expect(report).toContain('Creative Commons Attribution-ShareAlike');
  });

  it('summarises over all lists what it did not understand, most frequent first', async () => {
    const header =
      '<tr><th>Name</th><th>Gründung</th><th>Farben</th><th>Verband</th><th>Fechtfrage</th></tr>';
    const row = (name: string, colours: string, fencing: string) =>
      `<tr><td>${name}</td><td>1900</td><td>${colours}</td><td></td><td>${fencing}</td></tr>`;
    const fake = createFakeWikipedia({
      pages: {
        'Liste der Studentenverbindungen in Aachen': `<table>${header}${[
          row('A', 'rot-türkis', 'manchmal'),
          row('B', 'blau-türkis-kohle', 'manchmal'),
          row('C', 'schwarz-blassrot', 'selten'),
          row('D', 'rot-weiß (Burschenband)', ''),
          row('E', 'rot-weiß (Burschenband)', ''),
        ].join('')}</table>`,
      },
    });

    const {report} = await run({cities: ['Aachen']}, fake);

    expect(report).toContain(
      'Colours that could not be read, so the colours were left empty:\n    "tuerkis" x2',
    );
    expect(report).toContain(
      'Shades replaced by the closest colour of the palette:\n    "blassrot" x1\n    "kohle" x1',
    );
    expect(report).toContain(
      'Fencing principles that were not understood:\n    "manchmal" x2\n    "selten" x1',
    );
    expect(report).toContain('(Burschenband) x2');
  });

  it('says so in the report when there is nothing it did not understand', async () => {
    const {report} = await run({cities: ['Bern']});

    expect(report).toContain(
      'Colours that could not be read, so the colours were left empty: none',
    );
    expect(report).toContain(
      'Fencing principles that were not understood: none',
    );
  });

  describe('as input for the database builder', () => {
    it('produces a spreadsheet that builds into a database that the app accepts', async () => {
      const {rows, organisations} = await run({coordinates: true});
      const csv = stringifyCsv(CORPORATION_COLUMNS, rows);
      const organisationsCsv = stringifyCsv(
        ['abbreviation', 'name', 'indicatorColour'],
        organisations,
      );

      const result = await buildDatabase({
        corporationsCsv: csv,
        organisationsCsv,
        skipUnlocated: true,
      });

      // Only the corporations whose article has coordinates can be placed
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(Object.keys(result.database.corporations)).toEqual([
        'corporation_de_aachen_aachener_burschenschaft_teutonia',
        'corporation_de_aachen_corps_saxo_montania',
      ]);
      expect(result.stats).toMatchObject({corporations: 2, skipped: 7});
      expect(parseDatabase(JSON.stringify(result.database))).toMatchObject({
        ok: true,
        corporations: 2,
      });

      const model = new CouleurbummelModel(result.database);
      expect(
        model.corporation('corporation_de_aachen_corps_saxo_montania'),
      ).toMatchObject({
        foundationDate: '1798',
        fencingPrinciple: 4,
      });
    });

    it('gives spreadsheet files that the builder reads without complaint about columns', async () => {
      const {rows, organisations} = await run({});
      const csv = stringifyCsv(CORPORATION_COLUMNS, rows);
      const organisationsCsv = stringifyCsv(
        ['abbreviation', 'name', 'indicatorColour'],
        organisations.map(o => ({...o, indicatorColour: ''})),
      );

      const result = await buildDatabase({
        corporationsCsv: csv,
        organisationsCsv,
        skipUnlocated: true,
      });

      expect(result.warnings).toEqual([]);
      expect(result.skipped).toHaveLength(9);
      expect(readTable(csv, CORPORATION_COLUMNS).unknownColumns).toEqual([]);
    });

    it('lets every corporation through when coordinates are filled in', async () => {
      const {rows} = await run({});
      const located = rows.map((r, i) => ({
        ...r,
        street: `Straße ${i}`,
        latitude: 50 + i / 100,
        longitude: 6 + i / 100,
      }));

      const result = await buildDatabase({
        corporationsCsv: stringifyCsv(CORPORATION_COLUMNS, located),
      });

      expect(result.errors).toEqual([]);
      expect(result.stats.corporations).toBe(9);
      expect(
        result.database.corporations
          .corporation_de_aachen_akademischer_verein_test.coloursPrinciple,
      ).toBe(3);
      expect(
        result.database.corporations.corporation_de_aachen_corps_saxo_montania
          .coloursPrinciple,
      ).toBe(5);
      expect(Object.keys(result.database.countries).sort()).toEqual([
        'country_at',
        'country_ch',
        'country_de',
      ]);
      expect(
        result.database.organisations.organisation_kscv.mapDisplayableIds,
      ).toHaveLength(2);
    });
  });
});

describe('main', () => {
  let directory: string;
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: {log: (m: string) => out.push(m), error: (m: string) => err.push(m)},
      out,
      err,
    };
  };
  const client = () =>
    createClient({
      userAgent: 'agent',
      fetchImpl: createFakeWikipedia().fetchImpl as unknown as typeof fetch,
      wait: noWait,
    });

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wikipedia-import-'));
  });
  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  it('writes the spreadsheets and the report', async () => {
    const {io: console_, out} = io();
    const files = ['corporations.csv', 'organisations.csv', 'report.txt'].map(
      f => path.join(directory, 'nested', f),
    );

    const code = await main(
      [
        '--contact',
        'me@example.org',
        '--out',
        files[0],
        '--organisations-out',
        files[1],
        '--report',
        files[2],
        '--coordinates',
      ],
      console_,
      {client: client()},
    );

    expect(code).toBe(0);
    expect(out.at(-2)).toContain('Wrote 9 corporations from 4 lists');
    expect(out.at(-1)).toContain('7 of them have no coordinates yet');

    const corporations = readTable(
      fs.readFileSync(files[0], 'utf8'),
      CORPORATION_COLUMNS,
    );
    expect(corporations.unknownColumns).toEqual([]);
    expect(corporations.rows).toHaveLength(9);
    expect(corporations.rows[0].values).toMatchObject({
      shortName: 'Corps Saxo-Montania',
      city: 'Aachen',
      country: 'DE',
    });

    const organisations = readTable(fs.readFileSync(files[1], 'utf8'), [
      'abbreviation',
      'name',
      'indicatorColour',
    ]);
    expect(organisations.rows.map(r => r.values.abbreviation)).toEqual([
      'ADB',
      'CV',
      'KSCV',
      'NDB',
      'ÖCV',
      'STV',
      'WSC',
    ]);
    expect(fs.readFileSync(files[2], 'utf8')).toContain('Corporations: 9');
  });

  it('lists the lists without reading them', async () => {
    const {io: console_, out} = io();

    const code = await main(
      ['--contact', 'me@example.org', '--list-only', '--country', 'Bern=DE'],
      console_,
      {
        client: client(),
      },
    );

    expect(code).toBe(0);
    expect(out).toEqual([
      'DE  Aachen  ←  Liste der Studentenverbindungen in Aachen',
      'AT  Wien  ←  Liste der Studenten- und Schülerverbindungen in Wien',
      'DE  Bern  ←  Liste der Studentenverbindungen in Bern',
      'DE  Koblenz und Vallendar  ←  Liste der Studentenverbindungen in Koblenz und Vallendar',
      '4 lists found. Fix countries with --country "City=XX".',
    ]);
  });

  it('says so when Wikipedia cannot be reached', async () => {
    const {io: console_, err} = io();
    const failing = createClient({
      userAgent: 'agent',
      fetchImpl: jest.fn().mockRejectedValue(new Error('fetch failed')),
      wait: noWait,
    });

    const code = await main(['--contact', 'me@example.org'], console_, {
      client: failing,
    });

    expect(code).toBe(1);
    expect(err.join('\n')).toContain(
      "Couldn't read from Wikipedia: fetch failed",
    );
  });

  it.each([
    [[], /--contact/],
    [['--contact', 'a@b.c', '--bogus'], /Unknown option --bogus/],
    [['--contact', 'a@b.c', 'stray'], /Unexpected argument stray/],
    [['--contact'], /--contact needs a value/],
    [['--contact', 'a@b.c', '--country', 'Bern'], /"City=XX"/],
    [['--contact', 'a@b.c', '--lists', '('], /not a valid regular expression/],
  ])('rejects the arguments %p', async (args, message) => {
    const {io: console_, err} = io();

    expect(await main(args as string[], console_, {client: client()})).toBe(2);
    expect(err.join('\n')).toMatch(message);
  });

  it('shows the usage', async () => {
    const {io: console_, out} = io();

    expect(await main(['--help'], console_)).toBe(0);
    expect(out.join('\n')).toContain('Usage:');
  });
});
