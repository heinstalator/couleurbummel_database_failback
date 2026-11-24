import fs from 'fs';
import os from 'os';
import path from 'path';

import schema from '../../resources/couleurbummel.schema.json';
import en from '../../src/locales/en';
import {CouleurbummelModel} from '../../src/model/model';
import {parseDatabase} from '../../src/model/validation';
import {
  buildDatabase,
  COLOURS,
  FAMILIES,
  main,
  parseCsv,
  parseSashes,
  readTable,
  resolveColour,
  stringifyCsv,
} from '../../tools/build-database/build-database';

const toolDirectory = path.join(__dirname, '../../tools/build-database');
const readTemplate = (name: string) =>
  fs.readFileSync(path.join(toolDirectory, name), 'utf8');

const HEADER = 'shortName,city,country,latitude,longitude';
const build = (rows: string[], header = HEADER, organisationsCsv?: string) =>
  buildDatabase({
    corporationsCsv: [header, ...rows].join('\n'),
    organisationsCsv,
  });

describe('parseCsv', () => {
  it('reads simple records', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('detects semicolons, as exported by spreadsheets in German locales', () => {
    expect(parseCsv('a;b\n1,5;2')).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
  });

  it('detects tabs', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quotes, escaped quotes, delimiters and line breaks inside fields', () => {
    expect(parseCsv('a,b\n"x, ""y""","line 1\nline 2"')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'line 1\nline 2'],
    ]);
  });

  it('handles a byte order mark and Windows line endings', () => {
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,b,c\n,,3')).toEqual([
      ['a', 'b', 'c'],
      ['', '', '3'],
    ]);
  });
});

describe('readTable', () => {
  it('matches column names case-insensitively, reports unknown ones and numbers rows like a spreadsheet', () => {
    const table = readTable('SHORTNAME , Typo\nA,x\n\n,\nB,y', [
      'shortName',
      'city',
    ]);

    expect(table.columns).toEqual(['shortName']);
    expect(table.unknownColumns).toEqual(['Typo']);
    expect(table.rows).toEqual([
      {number: 2, values: {shortName: 'A'}},
      {number: 5, values: {shortName: 'B'}},
    ]);
  });
});

describe('colours', () => {
  it.each([
    ['green', 'colour_green'],
    ['Grün', 'colour_green'],
    ['weiß', 'colour_white'],
    ['blau_dunkel', 'colour_blue_dark'],
    ['dark blue', 'colour_blue_dark'],
    ['colour_red_wine', 'colour_red_wine'],
    ['Rot', 'colour_red'],
  ])('resolves %p to %p', (name, id) => {
    expect(resolveColour(name)).toBe(id);
  });

  it('lists the known colours when one is unknown', () => {
    expect(() => resolveColour('turquoise')).toThrow(
      /Unknown colour "turquoise".*blue_dark/,
    );
  });

  it('parses sashes with a base colour and a percussion', () => {
    expect(parseSashes('white-green-orange@black+gold | red-white')).toEqual([
      {
        colourIds: ['colour_white', 'colour_green', 'colour_orange'],
        baseColourId: 'colour_black',
        percussionColourId: 'colour_gold',
      },
      {colourIds: ['colour_red', 'colour_white']},
    ]);
    expect(parseSashes('')).toEqual([]);
    expect(parseSashes('blue@white')).toEqual([
      {colourIds: ['colour_blue'], baseColourId: 'colour_white'},
    ]);
  });

  it('only uses colour families that the app can translate', () => {
    for (const family of FAMILIES) {
      expect(en).toHaveProperty(`COLOUR_FAMILY_${family.toUpperCase()}`);
    }
    for (const [, family] of COLOURS) {
      expect(FAMILIES).toContain(family);
    }
  });
});

describe('buildDatabase with the template', () => {
  const buildTemplate = () =>
    buildDatabase({
      corporationsCsv: readTemplate('corporations.template.csv'),
      organisationsCsv: readTemplate('organisations.template.csv'),
    });

  it('builds without problems', async () => {
    const {errors, warnings, stats} = await buildTemplate();

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(stats).toEqual({
      skipped: 0,
      corporations: 4,
      addresses: 3,
      cities: 3,
      countries: 3,
      organisations: 3,
    });
  });

  it('is accepted by the validation that the import in the app uses', async () => {
    const {database} = await buildTemplate();

    expect(parseDatabase(JSON.stringify(database))).toMatchObject({
      ok: true,
      corporations: 4,
    });
  });

  it('can be loaded by the app and is usable there', async () => {
    const {database} = await buildTemplate();
    const model = new CouleurbummelModel(database);

    const corps = model.corporation(
      'corporation_de_musterstadt_corps_beispiel',
    );
    expect(corps).toMatchObject({
      shortName: 'Corps Beispiel',
      coloursPrinciple: 5,
      fencingPrinciple: 4,
      foundationDate: '1850',
      indicatorColourId: 'ind_orange',
    });

    // The two corporations in the same house share one address
    const [[address, inAddress]] = model.addressesWithCorporations([
      'address_musterstadt_0',
    ]);
    expect(address.fullAddress).toBe('Musterstraße 1\nD-12345\nMusterstadt');
    expect(inAddress.map(c => c.shortName).sort()).toEqual([
      'Corps Beispiel',
      'KDStV Muster',
    ]);

    expect(model.allCities().map(c => c.name)).toEqual([
      'Innsbruck',
      'Musterstadt',
      'Teststadt',
    ]);
    expect(model.citiesWithAddresses(['city_de_musterstadt'])).toHaveLength(1);
    expect(
      model
        .allCountries()
        .map(c => c.isoCode)
        .sort(),
    ).toEqual(['at', 'ch', 'de']);
    expect(
      model
        .allOrganisations()
        .map(o => o.abbreviation)
        .sort(),
    ).toEqual(['CV', 'KSCV', 'KV']);

    // Every colour of every sash has a value to draw
    for (const sash of corps?.colours ?? []) {
      const ids = [sash.colourIds, sash.baseColourId, sash.percussionColourId]
        .flat()
        .filter(Boolean) as string[];
      expect(model.colourValues(ids)).toHaveLength(ids.length);
    }
    expect(model.allColourFamilies()).toHaveLength(FAMILIES.length);
  });

  it('hides corporations marked as hidden', async () => {
    const {database} = await buildTemplate();
    const model = new CouleurbummelModel(database);

    expect(
      database.corporations.corporation_ch_beispiel_ver_teststadt.hidden,
    ).toBe(true);
    expect(
      model.corporation('corporation_ch_beispiel_ver_teststadt'),
    ).toBeUndefined();
  });

  it('has no dangling references', async () => {
    const {database: db} = await buildTemplate();
    const ids = (table: string) => new Set(Object.keys(db[table] ?? {}));
    const dangling: string[] = [];
    const check = (table: string, field: string, target: string[]) => {
      const known = new Set(target.flatMap(t => [...ids(t)]));
      for (const entry of Object.values<any>(db[table])) {
        for (const ref of [entry[field]].flat().filter(Boolean)) {
          if (!known.has(ref)) {
            dangling.push(`${table}.${field}=${ref}`);
          }
        }
      }
    };

    check('corporations', 'addressId', ['addresses']);
    check('corporations', 'organisationIds', ['organisations']);
    check('corporations', 'indicatorColourId', ['colours']);
    check('addresses', 'corporationIds', ['corporations']);
    check('addresses', 'cityIds', ['cities']);
    check('cities', 'addressIds', ['addresses']);
    check('cities', 'countryId', ['countries']);
    check('countries', 'cityIds', ['cities']);
    check('organisations', 'mapDisplayableIds', ['corporations']);
    check('organisations', 'indicatorColourId', ['colours']);
    check('colourFamilies', 'memberColourIds', ['colours']);
    check('colours', 'colourFamilyIds', ['colourFamilies']);
    check('colours', 'inColours', ['corporations']);

    for (const corporation of Object.values<any>(db.corporations)) {
      for (const sash of corporation.colours ?? []) {
        for (const id of [
          sash.colourIds,
          sash.baseColourId,
          sash.percussionColourId,
        ]
          .flat()
          .filter(Boolean)) {
          if (!ids('colours').has(id)) {
            dangling.push(`sash colour ${id}`);
          }
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  it('follows the constraints of the schema', async () => {
    const {database: db} = await buildTemplate();
    const defs = schema.$defs as any;
    const foundation = new RegExp(
      defs.corporation.properties.foundationDate.pattern,
    );
    const translationKey = new RegExp(defs.translationKey.pattern);
    const isoCode = new RegExp(defs.country.properties.isoCode.pattern);
    const colours = defs.corporation.properties;

    for (const c of Object.values<any>(db.corporations)) {
      for (const required of defs.corporation.required) {
        expect(c).toHaveProperty(required);
      }
      expect(c.coloursPrinciple).toBeGreaterThanOrEqual(
        colours.coloursPrinciple.minimum,
      );
      expect(c.coloursPrinciple).toBeLessThanOrEqual(
        colours.coloursPrinciple.maximum,
      );
      expect(c.fencingPrinciple).toBeGreaterThanOrEqual(
        colours.fencingPrinciple.minimum,
      );
      expect(c.fencingPrinciple).toBeLessThanOrEqual(
        colours.fencingPrinciple.maximum,
      );
      if (c.foundationDate) {
        expect(c.foundationDate).toMatch(foundation);
      }
    }

    const requiredFields: Record<string, string> = {
      addresses: 'address',
      cities: 'city',
      colours: 'colour',
      colourFamilies: 'colourFamily',
      countries: 'country',
      organisations: 'organisation',
    };
    for (const [table, def] of Object.entries(requiredFields)) {
      for (const entry of Object.values<any>(db[table])) {
        for (const required of defs[def].required) {
          expect(entry).toHaveProperty(required);
        }
        if (entry.translationKey) {
          expect(entry.translationKey).toMatch(translationKey);
        }
      }
    }
    for (const country of Object.values<any>(db.countries)) {
      expect(country.isoCode).toMatch(isoCode);
    }
  });

  it('produces the same output every time', async () => {
    const first = JSON.stringify((await buildTemplate()).database);
    const second = JSON.stringify((await buildTemplate()).database);

    expect(first).toBe(second);
  });
});

describe('buildDatabase rows', () => {
  it('derives IDs like the existing database and defaults the long name', async () => {
    const {database, errors} = await build([
      'KDStV Bergland,Aachen,de,50.7,6.0',
    ]);

    expect(errors).toEqual([]);
    expect(
      database.corporations.corporation_de_aachen_kdstv_bergland,
    ).toMatchObject({
      longName: 'KDStV Bergland',
      addressId: 'address_aachen_0',
      coloursPrinciple: 0,
      fencingPrinciple: 0,
      indicatorColourId: 'ind_grey',
    });
    expect(database.cities.city_de_aachen).toMatchObject({
      name: 'Aachen',
      translationKey: 'LOC_CITY_AACHEN',
      countryId: 'country_de',
    });
  });

  it('keeps umlauts in IDs, like the existing database', async () => {
    const {database} = await build(['Verbindung,Tübingen,DE,48.5,9.0']);

    expect(Object.keys(database.cities)).toEqual(['city_de_tübingen']);
  });

  it('accepts country names and German decimal commas', async () => {
    const {database, errors} = await build([
      '"A","Wien","Österreich","48,21","16,37"',
    ]);

    expect(errors).toEqual([]);
    expect(database.addresses.address_wien_0).toMatchObject({
      latitude: 48.21,
      longitude: 16.37,
    });
    expect(database.countries.country_at.isoCode).toBe('at');
  });

  it('builds postal addresses like the existing database', async () => {
    const {database} = await build(
      [
        'A,Rütscher Straße 110,52072,Aachen,DE,50.7,6.0',
        'B,Färbergasse 8,1010,Wien,AT,48.2,16.3',
        'C,Testgasse 3,8001,Zürich,CH,47.3,8.5',
        'D,,,Aachen,DE,50.8,6.1',
      ],
      'shortName,street,postalCode,city,country,latitude,longitude',
    );

    const full = (Object.values(database.addresses) as any[]).map(
      a => a.fullAddress,
    );
    expect(full).toEqual(
      expect.arrayContaining([
        'Rütscher Straße 110\nD-52072\nAachen',
        'Färbergasse 8\nA-1010\nWien',
        'Testgasse 3\nCH-8001\nZürich',
        'Aachen',
      ]),
    );
  });

  it('puts corporations at the same address together, but not those without a street', async () => {
    const header =
      'shortName,street,postalCode,city,country,latitude,longitude';
    const together = await build(
      ['A,Hauptstr. 1,12345,X,DE,50,6', 'B,hauptstr. 1,12345,X,DE,50,6'],
      header,
    );
    const apart = await build(['A,,,X,DE,50,6', 'B,,,X,DE,51,7'], header);

    expect(together.stats.addresses).toBe(1);
    expect(together.warnings).toEqual([]);
    expect(apart.stats.addresses).toBe(2);
  });

  it('warns if corporations at the same address disagree about its coordinates', async () => {
    const {warnings, database} = await build(
      ['A,Hauptstr. 1,12345,X,DE,50,6', 'B,Hauptstr. 1,12345,X,DE,51,7'],
      'shortName,street,postalCode,city,country,latitude,longitude',
    );

    expect(warnings).toEqual([
      expect.stringMatching(/row 3 \(B\).*first ones are used/),
    ]);
    expect(database.addresses.address_x_0).toMatchObject({
      latitude: 50,
      longitude: 6,
    });
  });

  it('takes the pin colour from the first organisation that has one, unless given', async () => {
    const organisations =
      'abbreviation,name,indicatorColour\nCV,Cartellverband,Grün\nKV,Kartellverband,\n';
    const header =
      'shortName,city,country,latitude,longitude,organisations,indicatorColour';
    const {database, errors} = await build(
      ['A,X,DE,50,6,KV|CV,', 'B,X,DE,50,6,CV,red', 'C,X,DE,50,6,,'],
      header,
      organisations,
    );

    expect(errors).toEqual([]);
    const pin = (id: string) => database.corporations[id].indicatorColourId;
    expect(pin('corporation_de_x_a')).toBe('ind_green');
    expect(pin('corporation_de_x_b')).toBe('ind_red');
    expect(pin('corporation_de_x_c')).toBe('ind_grey');
    expect(database.organisations.organisation_cv.mapDisplayableIds).toEqual([
      'corporation_de_x_a',
      'corporation_de_x_b',
    ]);
  });

  it('creates organisations that are not defined, with a warning', async () => {
    const {database, warnings} = await build(
      ['A,X,DE,50,6,CV'],
      `${HEADER},organisations`,
    );

    expect(database.organisations.organisation_cv).toMatchObject({
      abbreviation: 'CV',
      name: 'CV',
    });
    expect(warnings).toEqual([
      expect.stringContaining('organisation "CV" isn\'t defined'),
    ]);
  });

  it('records which corporations use which colours', async () => {
    const {database} = await build(
      ['A,X,DE,50,6,blue-white@black', 'B,X,DE,50,6,white'],
      `${HEADER},colours`,
    );

    expect(database.colours.colour_white.inColours).toEqual([
      'corporation_de_x_a',
      'corporation_de_x_b',
    ]);
    expect(database.colours.colour_black.inColours).toEqual([
      'corporation_de_x_a',
    ]);
    expect(database.colours.colour_red.inColours).toEqual([]);
  });

  it('reads principles as numbers or words and dates in several forms', async () => {
    const {database, errors} = await build(
      [
        'A,X,DE,50,6,5,4,1999',
        'B,X,DE,50,6,Fakultativ,nichtschlagend,2001-02-03',
        'C,X,DE,50,6,not wearing,pflichtschlagend,4.12.1850',
      ],
      `${HEADER},coloursPrinciple,fencingPrinciple,foundationDate`,
    );

    expect(errors).toEqual([]);
    const c = database.corporations;
    expect(
      [c.corporation_de_x_a, c.corporation_de_x_b, c.corporation_de_x_c].map(
        x => [x.coloursPrinciple, x.fencingPrinciple, x.foundationDate],
      ),
    ).toEqual([
      [5, 4, '1999'],
      [4, 1, '2001-02-03'],
      [3, 4, '1850-12-04'],
    ]);
  });

  it('warns about columns it does not know', async () => {
    const {warnings} = await build(['A,X,DE,50,6,oops'], `${HEADER},websit`);

    expect(warnings).toEqual([
      expect.stringContaining('unknown column "websit"'),
    ]);
  });
});

describe('buildDatabase problems', () => {
  const problems = async (rows: string[], header = HEADER) =>
    (await build(rows, header)).errors;

  it.each([
    ['a missing short name', ',X,DE,50,6', 'row 2: shortName is required'],
    ['a missing city', 'A,,DE,50,6', 'city is required'],
    [
      'a country that is not a code',
      'A,X,Deutschlandia,50,6',
      'country "Deutschlandia" must be an ISO 3166 code',
    ],
    ['a latitude that is out of range', 'A,X,DE,91,6', 'latitude "91"'],
    ['a longitude that is not a number', 'A,X,DE,50,six', 'longitude "six"'],
    ['only one coordinate', 'A,X,DE,50,', 'both be filled in or both be empty'],
  ])('reports %s', async (_what, row, message) => {
    expect(await problems([row])).toEqual([expect.stringContaining(message)]);
  });

  it.each([
    [
      'coloursPrinciple',
      '7',
      'coloursPrinciple "7" must be a number from 0 to 5',
    ],
    ['coloursPrinciple', 'sometimes', 'coloursPrinciple "sometimes"'],
    [
      'fencingPrinciple',
      '5',
      'fencingPrinciple "5" must be a number from 0 to 4',
    ],
    ['foundationDate', '1910-13-01', 'foundationDate "1910-13-01"'],
    ['foundationDate', 'last century', 'foundationDate "last century"'],
    ['colours', 'blue-turquoise', 'Unknown colour "turquoise"'],
    ['colours', 'blue@white@black', "Couldn't read the colours"],
    ['indicatorColour', 'magenta', 'Unknown pin colour "magenta"'],
    ['hidden', 'maybe', '"maybe" is not yes or no'],
  ])('reports a bad %s (%s)', async (column, value, message) => {
    expect(
      await problems([`A,X,DE,50,6,${value}`], `${HEADER},${column}`),
    ).toEqual([expect.stringContaining(message)]);
  });

  it('reports every problem at once, with the row it is in', async () => {
    const errors = await problems(['A,X,DE,91,6', 'B,X,DE,50,6', ',X,DE,50,6']);

    expect(errors).toEqual([
      expect.stringMatching(/^Corporations, row 2 \(A\): latitude/),
      expect.stringMatching(/^Corporations, row 4: shortName is required/),
    ]);
  });

  it('refuses two corporations with the same ID', async () => {
    const errors = await problems(['A,X,DE,50,6', 'A,X,DE,50,6']);

    expect(errors).toEqual([
      expect.stringContaining(
        '"corporation_de_x_a" is already used by another row',
      ),
    ]);
  });

  it('lets an explicit ID tell apart corporations with the same name', async () => {
    const {errors, database} = await build(
      ['first,A,X,DE,50,6', 'second,A,X,DE,51,7'],
      `id,${HEADER}`,
    );

    expect(errors).toEqual([]);
    expect(Object.keys(database.corporations).sort()).toEqual([
      'first',
      'second',
    ]);
  });

  it('refuses rows without coordinates unless they can be looked up', async () => {
    expect(await problems(['A,X,DE,,'])).toEqual([
      expect.stringContaining(
        'no coordinates. Fill in latitude and longitude, or run the tool with --geocode',
      ),
    ]);
  });

  it('reports missing required columns once', async () => {
    const errors = await problems(['A,1'], 'shortName,latitude');

    expect(errors).toEqual([
      'Corporations: the column "city" is missing',
      'Corporations: the column "country" is missing',
    ]);
  });

  it('reports an empty file', async () => {
    expect((await buildDatabase({corporationsCsv: ''})).errors).toEqual([
      'Corporations: the file contains no rows',
    ]);
  });

  it('reports problems in the organisations file', async () => {
    const {errors} = await build(
      ['A,X,DE,50,6'],
      HEADER,
      'abbreviation,name,indicatorColour\nCV,,green\nKV,Kartell,pinkish\nKV,Again,\nKV,Third,\n',
    );

    expect(errors).toEqual([
      'Organisations, row 2: abbreviation and name are required',
      expect.stringContaining(
        'Organisations, row 3: Unknown pin colour "pinkish"',
      ),
      'Organisations, row 4: "KV" appears twice',
      'Organisations, row 5: "KV" appears twice',
    ]);
  });
});

describe('geocoding', () => {
  const header = 'shortName,street,postalCode,city,country,latitude,longitude';
  const response = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
  const options = (fetchImpl: jest.Mock, cache = {}) => ({
    cache,
    userAgent: 'test-agent (me@example.org)',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    wait: jest.fn().mockResolvedValue(undefined),
  });
  const run = (rows: string[], geocodeOptions: ReturnType<typeof options>) =>
    buildDatabase({
      corporationsCsv: [header, ...rows].join('\n'),
      geocodeOptions,
    });

  it('looks up missing coordinates, identifies itself, and waits between requests', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response([{lat: '50.7762', lon: '6.0659'}]));
    const o = options(fetchImpl);

    const {database, errors} = await run(
      ['A,Hexenberg 10,52074,Aachen,DE,,'],
      o,
    );

    expect(errors).toEqual([]);
    expect(database.addresses.address_aachen_0).toMatchObject({
      latitude: 50.7762,
      longitude: 6.0659,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://nominatim.openstreetmap.org/search',
    );
    expect(parsed.searchParams.get('q')).toBe('Hexenberg 10, 52074 Aachen, DE');
    expect(parsed.searchParams.get('countrycodes')).toBe('de');
    expect(parsed.searchParams.get('format')).toBe('jsonv2');
    expect(init.headers['User-Agent']).toBe('test-agent (me@example.org)');
    expect(o.wait).toHaveBeenCalledWith(1100);
  });

  it('does not look up what it has been given or already knows', async () => {
    const fetchImpl = jest.fn();
    const cache = {
      'Hexenberg 10, 52074 Aachen, DE': {latitude: 1, longitude: 2},
    };
    const o = options(fetchImpl, cache);

    const {database} = await run(
      ['A,Hexenberg 10,52074,Aachen,DE,,', 'B,Elsewhere 1,11111,Y,DE,50,6'],
      o,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(o.wait).not.toHaveBeenCalled();
    expect(database.addresses.address_aachen_0).toMatchObject({
      latitude: 1,
      longitude: 2,
    });
  });

  it('looks up an address shared by several corporations once and remembers the result', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response([{lat: '1', lon: '2'}]));
    const o = options(fetchImpl);

    await run(['A,Haus 1,11111,X,DE,,', 'B,Haus 1,11111,X,DE,,'], o);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(o.cache).toEqual({
      'Haus 1, 11111 X, DE': {latitude: 1, longitude: 2},
    });
  });

  it('says so when an address is not found, and does not ask again', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response([]));
    const o = options(fetchImpl);

    const {errors} = await run(['A,Nowhere 1,11111,X,DE,,'], o);
    const again = await run(['A,Nowhere 1,11111,X,DE,,'], o);

    expect(errors).toEqual([
      expect.stringContaining(
        "wasn't found. Enter latitude and longitude yourself",
      ),
    ]);
    expect(again.errors).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'the service refuses',
      () => Promise.resolve(response({}, false, 429)),
      'status 429',
    ],
    [
      'the network is down',
      () => Promise.reject(new Error('Network down')),
      'Network down',
    ],
  ])('reports a failure when %s', async (_what, implementation, message) => {
    const o = options(jest.fn().mockImplementation(implementation));

    const {errors} = await run(['A,Haus 1,11111,X,DE,,'], o);

    expect(errors).toEqual([expect.stringContaining(message)]);
    expect(o.cache).toEqual({});
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

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'couleurbummel-'));
  });
  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  const template = (name: string) => path.join(toolDirectory, name);

  it('writes a database that the app accepts', async () => {
    const out = path.join(directory, 'nested', 'db.json');
    const {io: console_, out: log} = io();

    const code = await main(
      [
        template('corporations.template.csv'),
        '--organisations',
        template('organisations.template.csv'),
        '--out',
        out,
      ],
      console_,
    );

    expect(code).toBe(0);
    expect(log[0]).toContain(
      '4 corporations, 3 addresses, 3 cities, 3 countries, 3 organisations',
    );
    const text = fs.readFileSync(out, 'utf8');
    expect(text).toContain('\n  ');
    expect(parseDatabase(text).ok).toBe(true);
  });

  it('can write the JSON on one line', async () => {
    const out = path.join(directory, 'db.json');

    await main(
      [template('corporations.template.csv'), '--out', out, '--minify'],
      io().io,
    );

    expect(fs.readFileSync(out, 'utf8')).not.toContain('\n');
  });

  it('writes nothing and fails if there are problems, but still shows warnings', async () => {
    const csv = path.join(directory, 'in.csv');
    const out = path.join(directory, 'db.json');
    fs.writeFileSync(
      csv,
      'shortName,city,country,latitude,longitude,oops\nA,X,DE,95,6,1\n',
    );
    const {io: console_, err} = io();

    const code = await main([csv, '--out', out], console_);

    expect(code).toBe(1);
    expect(fs.existsSync(out)).toBe(false);
    expect(err.join('\n')).toMatch(/Warning: .*unknown column "oops"/);
    expect(err.join('\n')).toMatch(
      /1 problem\(s\) found.*row 2 \(A\): latitude "95"/s,
    );
  });

  it.each([
    [[], /exactly one corporations CSV/],
    [['a.csv', 'b.csv'], /exactly one corporations CSV/],
    [['a.csv', '--bogus'], /Unknown option --bogus/],
    [['a.csv', '--out'], /--out needs a value/],
    [['a.csv', '--geocode'], /--contact/],
  ])('rejects the arguments %p', async (args, message) => {
    const {io: console_, err} = io();

    expect(await main(args as string[], console_)).toBe(2);
    expect(err.join('\n')).toMatch(message);
  });

  it('says so when a file cannot be read', async () => {
    const {io: console_, err} = io();

    expect(await main([path.join(directory, 'missing.csv')], console_)).toBe(2);
    expect(err.join('\n')).toMatch(/Couldn't read the file/);
  });

  it('shows the usage', async () => {
    const {io: console_, out} = io();

    expect(await main(['--help'], console_)).toBe(0);
    expect(out.join('\n')).toContain('Usage:');
  });
});

describe('stringifyCsv', () => {
  it('quotes fields that need it and round-trips through the reader', () => {
    const rows = [
      {a: 'plain', b: 'with, comma'},
      {a: 'say "hi"', b: 'two\nlines'},
      {a: '', b: undefined},
    ];

    const text = stringifyCsv(['a', 'b'], rows);

    expect(text).toBe(
      'a,b\nplain,"with, comma"\n"say ""hi""","two\nlines"\n,\n',
    );
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['plain', 'with, comma'],
      ['say "hi"', 'two\nlines'],
      ['', ''],
    ]);
  });
});

describe('skipping corporations that cannot be placed', () => {
  const header = 'shortName,street,postalCode,city,country,latitude,longitude';
  const run = (rows: string[], extra = {}) =>
    buildDatabase({
      corporationsCsv: [header, ...rows].join('\n'),
      skipUnlocated: true,
      ...extra,
    });

  it('sets them aside, with their data, instead of failing', async () => {
    const {database, errors, skipped, stats} = await run([
      'Placed,Hauptstr. 1,12345,X,DE,50,6',
      'Not placed,Nebenstr. 2,12345,X,DE,,',
      'Only a city,,,Y,DE,,',
    ]);

    expect(errors).toEqual([]);
    expect(Object.keys(database.corporations)).toEqual([
      'corporation_de_x_placed',
    ]);
    expect(
      skipped.map(r => [r.number, r.values.shortName, r.values.street]),
    ).toEqual([
      [3, 'Not placed', 'Nebenstr. 2'],
      [4, 'Only a city', ''],
    ]);
    expect(stats).toMatchObject({corporations: 1, skipped: 2});
    // Nothing of a skipped row ends up in the database
    expect(Object.keys(database.cities)).toEqual(['city_de_x']);
    expect(Object.keys(database.addresses)).toHaveLength(1);
  });

  it('does not skip a corporation that shares an address with a placed one', async () => {
    const {database, skipped} = await run([
      'A,Hauptstr. 1,12345,X,DE,50,6',
      'B,Hauptstr. 1,12345,X,DE,,',
    ]);

    expect(skipped).toEqual([]);
    expect(database.addresses.address_x_0.corporationIds).toEqual([
      'corporation_de_x_a',
      'corporation_de_x_b',
    ]);
  });

  it('still reports other problems as errors', async () => {
    const {errors, skipped} = await run(['A,,,X,DE,95,6', 'B,,,X,DE,,']);

    expect(errors).toEqual([expect.stringContaining('latitude "95"')]);
    expect(skipped).toHaveLength(1);
  });

  it('fails if nothing is left', async () => {
    const {errors} = await run(['A,,,X,DE,,']);

    expect(errors).toEqual([
      'Corporations: none of the 1 corporations has coordinates, so there is nothing to put on the map',
    ]);
  });

  it('keeps rows that can be looked up because they have a street, but not those that only have a city', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{lat: '1', lon: '2'}]),
    });

    const {database, skipped} = await run(
      ['A,Hauptstr. 1,12345,X,DE,,', 'B,,,X,DE,,'],
      {
        geocodeOptions: {
          cache: {},
          userAgent: 'test',
          fetchImpl: fetchImpl as unknown as typeof fetch,
          wait: jest.fn().mockResolvedValue(undefined),
        },
      },
    );

    expect(Object.keys(database.corporations)).toEqual(['corporation_de_x_a']);
    expect(skipped.map(r => r.values.shortName)).toEqual(['B']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('geocoding without a street', () => {
  it('refuses to look up a bare city, which would put the pin in the middle of town', async () => {
    const fetchImpl = jest.fn();

    const {errors} = await buildDatabase({
      corporationsCsv: 'shortName,city,country\nA,Aachen,DE',
      geocodeOptions: {
        cache: {},
        userAgent: 'test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        wait: jest.fn().mockResolvedValue(undefined),
      },
    });

    expect(errors).toEqual([
      expect.stringContaining("without a street they can't be looked up"),
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('main with skipped corporations', () => {
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'couleurbummel-'));
  });
  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  it('writes the skipped corporations as CSV that can be completed and read again', async () => {
    const csv = path.join(directory, 'in.csv');
    const out = path.join(directory, 'db.json');
    const skipped = path.join(directory, 'skipped.csv');
    fs.writeFileSync(
      csv,
      'shortName,street,city,country,latitude,longitude,motto\n' +
        'Placed,Hauptstr. 1,X,DE,50,6,\n' +
        'Not placed,"Nebenstr. 2",X,DE,,,"Hello, world"\n',
    );
    const err: string[] = [];

    const code = await main(
      [csv, '--out', out, '--skip-unlocated', '--skipped-out', skipped],
      {log: () => {}, error: m => err.push(m)},
    );

    expect(code).toBe(0);
    expect(err.join('\n')).toMatch(
      /Left out 1 corporations without coordinates, saved in /,
    );
    expect(parseDatabase(fs.readFileSync(out, 'utf8')).ok).toBe(true);

    // The file has all the columns of the template, so it can be completed and built again
    const table = readTable(fs.readFileSync(skipped, 'utf8'), [
      'shortName',
      'street',
      'motto',
      'latitude',
    ]);
    expect(table.unknownColumns).toEqual(
      expect.arrayContaining(['id', 'longName', 'colours']),
    );
    expect(table.rows[0].values).toMatchObject({
      shortName: 'Not placed',
      street: 'Nebenstr. 2',
      motto: 'Hello, world',
      latitude: '',
    });
  });

  it('suggests how to save them when no file is given', async () => {
    const csv = path.join(directory, 'in.csv');
    fs.writeFileSync(
      csv,
      'shortName,city,country,latitude,longitude\nA,X,DE,50,6\nB,X,DE,,\n',
    );
    const err: string[] = [];

    await main(
      [csv, '--out', path.join(directory, 'db.json'), '--skip-unlocated'],
      {log: () => {}, error: m => err.push(m)},
    );

    expect(err.join('\n')).toContain('Add --skipped-out <file> to save them');
  });
});
