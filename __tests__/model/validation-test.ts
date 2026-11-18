import testDatabase from '../../resources/testDatabase.json';
import {MAX_DATABASE_LENGTH, parseDatabase} from '../../src/model/validation';

const clone = () => JSON.parse(JSON.stringify(testDatabase));

describe('parseDatabase', () => {
  it('accepts the test database', () => {
    const result = parseDatabase(JSON.stringify(testDatabase));

    expect(result).toMatchObject({
      ok: true,
      corporations: Object.keys(testDatabase.corporations).length,
    });
  });

  it('accepts a database wrapped in a single parent key', () => {
    const result = parseDatabase(JSON.stringify({prod: testDatabase}));

    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.database)).toContain('corporations');
  });

  it('drops keys that are not tables', () => {
    const db = {...clone(), somethingElse: {a: 1}};
    const result = parseDatabase(JSON.stringify(db));

    expect(result.ok && Object.keys(result.database)).not.toContain(
      'somethingElse',
    );
  });

  it.each(['', 'not json', '[]', '42', 'null', '"text"'])(
    'rejects %p as invalid JSON',
    text => {
      expect(parseDatabase(text)).toEqual({ok: false, error: 'INVALID_JSON'});
    },
  );

  it('rejects an object without any known table', () => {
    expect(parseDatabase('{"foo": {"bar": 1}}')).toEqual({
      ok: false,
      error: 'INCOMPLETE',
    });
  });

  it('rejects a database without corporations or without addresses', () => {
    const withoutCorporations = clone();
    delete withoutCorporations.corporations;
    const withoutAddresses = clone();
    withoutAddresses.addresses = {};

    expect(parseDatabase(JSON.stringify(withoutCorporations))).toEqual({
      ok: false,
      error: 'INCOMPLETE',
    });
    expect(parseDatabase(JSON.stringify(withoutAddresses))).toEqual({
      ok: false,
      error: 'INCOMPLETE',
    });
  });

  it('rejects a table that is a list', () => {
    const db = clone();
    db.cities = [];

    expect(parseDatabase(JSON.stringify(db))).toEqual({
      ok: false,
      error: 'INVALID_ENTRY',
      entry: 'cities',
    });
  });

  it('rejects an entry whose ID differs from its key', () => {
    const db = clone();
    const [key] = Object.keys(db.addresses);
    db.addresses[key].id = 'something_else';

    expect(parseDatabase(JSON.stringify(db))).toEqual({
      ok: false,
      error: 'INVALID_ENTRY',
      entry: `addresses/${key}`,
    });
  });

  it.each([
    ['latitude is out of range', {latitude: 91}],
    ['longitude is not a number', {longitude: '6.0'}],
    ['latitude is missing', {latitude: undefined}],
  ])('rejects an address if the %s', (_description, changes) => {
    const db = clone();
    const [key] = Object.keys(db.addresses);
    Object.assign(db.addresses[key], changes);

    expect(parseDatabase(JSON.stringify(db))).toEqual({
      ok: false,
      error: 'INVALID_ENTRY',
      entry: `addresses/${key}`,
    });
  });

  it.each([
    ['has no short name', {shortName: undefined}],
    ['has no address', {addressId: undefined}],
    ['has colours that are not a list', {colours: 'green'}],
    ['has a sash without colour IDs', {colours: [{}]}],
  ])('rejects a corporation that %s', (_description, changes) => {
    const db = clone();
    const [key] = Object.keys(db.corporations);
    Object.assign(db.corporations[key], changes);

    expect(parseDatabase(JSON.stringify(db))).toEqual({
      ok: false,
      error: 'INVALID_ENTRY',
      entry: `corporations/${key}`,
    });
  });

  it('rejects a city or organisation without a name', () => {
    const city = clone();
    const [cityKey] = Object.keys(city.cities);
    delete city.cities[cityKey].name;

    const organisation = clone();
    const [organisationKey] = Object.keys(organisation.organisations);
    delete organisation.organisations[organisationKey].name;

    expect(parseDatabase(JSON.stringify(city))).toMatchObject({
      error: 'INVALID_ENTRY',
      entry: `cities/${cityKey}`,
    });
    expect(parseDatabase(JSON.stringify(organisation))).toMatchObject({
      error: 'INVALID_ENTRY',
      entry: `organisations/${organisationKey}`,
    });
  });

  it('rejects input that is too large', () => {
    expect(parseDatabase(' '.repeat(MAX_DATABASE_LENGTH + 1))).toEqual({
      ok: false,
      error: 'TOO_LARGE',
    });
  });
});
