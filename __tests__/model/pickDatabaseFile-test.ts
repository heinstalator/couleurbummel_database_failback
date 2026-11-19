import {keepLocalCopy, pick, types} from '@react-native-documents/picker';

import {pickDatabaseFile} from '../../src/model/pickDatabaseFile';
import {MAX_DATABASE_LENGTH} from '../../src/model/validation';

// The native module isn't available in tests
jest.mock(
  '@react-native-documents/picker',
  () => ({pick: jest.fn(), keepLocalCopy: jest.fn(), types: {allFiles: '*/*'}}),
  {virtual: true},
);

const mockPick = pick as unknown as jest.Mock;
const mockKeepLocalCopy = keepLocalCopy as unknown as jest.Mock;

const SOURCE = 'content://files/db%3A1.json';
const LOCAL = 'file:///data/cache/db.json';

const chooses = (file: object = {}) =>
  mockPick.mockResolvedValue([
    {uri: SOURCE, name: 'db.json', size: 1000, ...file},
  ]);

const copySucceeds = () =>
  mockKeepLocalCopy.mockResolvedValue([
    {status: 'success', localUri: LOCAL, sourceUri: SOURCE},
  ]);

/** What reading an address returns, by address; an Error means that reading fails */
const files = (contents: Record<string, string | Error>) => {
  const fetchMock = jest.fn(async (uri: string) => {
    const content = contents[uri];
    if (content === undefined || content instanceof Error) {
      throw content ?? new Error('Network request failed');
    }
    return {text: async () => content};
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe('pickDatabaseFile', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    mockPick.mockReset();
    mockKeepLocalCopy.mockReset();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads the file from the local copy that was made of it', async () => {
    chooses();
    copySucceeds();
    const fetchMock = files({[LOCAL]: '{"corporations": {}}'});

    const result = await pickDatabaseFile();

    expect(result).toEqual({
      ok: true,
      text: '{"corporations": {}}',
      name: 'db.json',
    });
    expect(mockKeepLocalCopy).toHaveBeenCalledWith({
      files: [{uri: SOURCE, fileName: 'db.json'}],
      destination: 'cachesDirectory',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(LOCAL);
  });

  it('lets the user choose any kind of file, because file managers disagree on what JSON files are', async () => {
    chooses();
    copySucceeds();
    files({[LOCAL]: '{}'});

    await pickDatabaseFile();

    expect(mockPick).toHaveBeenCalledWith({type: [types.allFiles]});
  });

  it('names the copy even if the file has no name', async () => {
    chooses({name: null});
    copySucceeds();
    files({[LOCAL]: '{}'});

    expect(await pickDatabaseFile()).toMatchObject({ok: true, name: undefined});
    expect(mockKeepLocalCopy.mock.calls[0][0].files[0].fileName).toBe(
      'database.json',
    );
  });

  describe('if no local copy can be made', () => {
    const readsTheOriginalInstead = async (
      contents: Record<string, string | Error>,
    ) => {
      chooses();
      const fetchMock = files({[SOURCE]: '{"a": 1}', ...contents});

      expect(await pickDatabaseFile()).toEqual({
        ok: true,
        text: '{"a": 1}',
        name: 'db.json',
      });
      expect(fetchMock).toHaveBeenLastCalledWith(SOURCE);
    };

    it('reads the original address instead when the copy is reported as failed', async () => {
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'error', copyError: 'no space', sourceUri: SOURCE},
      ]);

      await readsTheOriginalInstead({});
    });

    it('reads the original address instead when making the copy throws', async () => {
      mockKeepLocalCopy.mockRejectedValue(new Error('not linked'));

      await readsTheOriginalInstead({});
    });

    it('reads the original address instead when the copy cannot be read', async () => {
      copySucceeds();

      await readsTheOriginalInstead({
        [LOCAL]: new Error('Network request failed'),
      });
    });
  });

  it('treats an empty result as a failure and tries the other way', async () => {
    chooses();
    copySucceeds();
    files({[LOCAL]: '', [SOURCE]: '{"a": 1}'});

    expect(await pickDatabaseFile()).toMatchObject({
      ok: true,
      text: '{"a": 1}',
    });
  });

  it('says what went wrong when nothing works', async () => {
    chooses();
    mockKeepLocalCopy.mockResolvedValue([
      {status: 'error', copyError: 'permission denied', sourceUri: SOURCE},
    ]);
    files({[SOURCE]: new Error('Network request failed')});

    const result = await pickDatabaseFile();

    expect(result).toEqual({
      ok: false,
      error: 'READ_FAILED',
      detail: 'copying: permission denied; direct: Network request failed',
    });
  });

  it('includes the error code of the problem, if there is one', async () => {
    chooses();
    mockKeepLocalCopy.mockRejectedValue(
      Object.assign(new Error('Module not found'), {code: 'E_NOT_LINKED'}),
    );
    files({[SOURCE]: new Error('Network request failed')});

    expect(await pickDatabaseFile()).toMatchObject({
      detail:
        'copy: E_NOT_LINKED: Module not found; direct: Network request failed',
    });
  });

  it.each([
    ['an error code', {code: 'OPERATION_CANCELED', message: 'x'}],
    ['an error message', new Error('User canceled document picker')],
  ])(
    'recognises that the user closed the picker by %s',
    async (_how, error) => {
      mockPick.mockRejectedValue(error);
      const fetchMock = files({});

      expect(await pickDatabaseFile()).toEqual({ok: false, error: 'CANCELLED'});
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    },
  );

  it('reports other problems with the picker, with the reason', async () => {
    mockPick.mockRejectedValue(new Error('Something broke'));

    expect(await pickDatabaseFile()).toEqual({
      ok: false,
      error: 'READ_FAILED',
      detail: 'picker: Something broke',
    });
  });

  it('refuses files that are far too large without reading them', async () => {
    chooses({size: MAX_DATABASE_LENGTH * 3 + 1});
    const fetchMock = files({});

    expect(await pickDatabaseFile()).toEqual({ok: false, error: 'TOO_LARGE'});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
  });

  it('leaves the exact size limit to the validation of the content', async () => {
    chooses({size: MAX_DATABASE_LENGTH * 2});
    copySucceeds();
    files({[LOCAL]: '{}'});

    expect(await pickDatabaseFile()).toMatchObject({ok: true});
  });
});
