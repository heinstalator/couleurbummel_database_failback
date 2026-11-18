import {pick, types} from '@react-native-documents/picker';

import {pickDatabaseFile} from '../../src/model/pickDatabaseFile';
import {MAX_DATABASE_LENGTH} from '../../src/model/validation';

// The native module isn't available in tests
jest.mock(
  '@react-native-documents/picker',
  () => ({pick: jest.fn(), types: {allFiles: '*/*'}}),
  {virtual: true},
);

const mockPick = pick as unknown as jest.Mock;

const chooses = (file: object) =>
  mockPick.mockResolvedValue([
    {uri: 'content://files/db.json', name: 'db.json', size: 1000, ...file},
  ]);

const fileContains = (text: string) => {
  const fetchMock = jest.fn().mockResolvedValue({text: async () => text});
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe('pickDatabaseFile', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    mockPick.mockReset();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads the content of the file that was chosen', async () => {
    chooses({});
    const fetchMock = fileContains('{"corporations": {}}');

    const result = await pickDatabaseFile();

    expect(result).toEqual({
      ok: true,
      text: '{"corporations": {}}',
      name: 'db.json',
    });
    expect(fetchMock).toHaveBeenCalledWith('content://files/db.json');
  });

  it('lets the user choose any kind of file, because file managers disagree on what JSON files are', async () => {
    chooses({});
    fileContains('{}');

    await pickDatabaseFile();

    expect(mockPick).toHaveBeenCalledWith({type: [types.allFiles]});
  });

  it('copes with a file that has no name', async () => {
    chooses({name: null});
    fileContains('{}');

    expect(await pickDatabaseFile()).toMatchObject({ok: true, name: undefined});
  });

  it.each([
    ['an error code', {code: 'OPERATION_CANCELED', message: 'x'}],
    ['an error message', new Error('User canceled document picker')],
  ])(
    'recognises that the user closed the picker by %s',
    async (_how, error) => {
      mockPick.mockRejectedValue(error);
      const fetchMock = fileContains('{}');

      expect(await pickDatabaseFile()).toEqual({ok: false, error: 'CANCELLED'});
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('reports other problems with the picker', async () => {
    mockPick.mockRejectedValue(new Error('Something broke'));

    expect(await pickDatabaseFile()).toEqual({ok: false, error: 'READ_FAILED'});
  });

  it('refuses files that are far too large without reading them', async () => {
    chooses({size: MAX_DATABASE_LENGTH * 3 + 1});
    const fetchMock = fileContains('{}');

    expect(await pickDatabaseFile()).toEqual({ok: false, error: 'TOO_LARGE'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the exact size limit to the validation of the content', async () => {
    chooses({size: MAX_DATABASE_LENGTH * 2});
    fileContains('{}');

    expect(await pickDatabaseFile()).toMatchObject({ok: true});
  });

  it.each([
    [
      'reading fails to start',
      () => jest.fn().mockRejectedValue(new Error('No such file')),
    ],
    [
      'reading the text fails',
      () =>
        jest.fn().mockResolvedValue({
          text: () => Promise.reject(new Error('Unreadable')),
        }),
    ],
  ])('reports it when %s', async (_what, makeFetch) => {
    chooses({});
    global.fetch = makeFetch() as unknown as typeof fetch;

    expect(await pickDatabaseFile()).toEqual({ok: false, error: 'READ_FAILED'});
  });
});
