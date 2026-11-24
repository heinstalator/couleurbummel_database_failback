import {readFile} from '@dr.pogodin/react-native-fs';
import {keepLocalCopy, pick, types} from '@react-native-documents/picker';

import {pickDatabaseFile} from '../../src/model/pickDatabaseFile';
import {MAX_DATABASE_LENGTH} from '../../src/model/validation';

// The native modules aren't available in tests
jest.mock(
  '@react-native-documents/picker',
  () => ({pick: jest.fn(), keepLocalCopy: jest.fn(), types: {allFiles: '*/*'}}),
  {virtual: true},
);
jest.mock('@dr.pogodin/react-native-fs', () => ({readFile: jest.fn()}), {
  virtual: true,
});

const mockPick = pick as unknown as jest.Mock;
const mockKeepLocalCopy = keepLocalCopy as unknown as jest.Mock;
const mockReadFile = readFile as unknown as jest.Mock;

const SOURCE = 'content://files/db%3A1.json';
const LOCAL_URI = 'file:///data/cache/my%20db.json';
const LOCAL_PATH = '/data/cache/my db.json';

const chooses = (file: object = {}) =>
  mockPick.mockResolvedValue([
    {uri: SOURCE, name: 'db.json', size: 1000, ...file},
  ]);

const copySucceeds = () =>
  mockKeepLocalCopy.mockResolvedValue([
    {status: 'success', localUri: LOCAL_URI, sourceUri: SOURCE},
  ]);

/** What reading a location returns; an Error means that reading it fails. Anything else can't be read. */
const files = (contents: Record<string, string | Error>) =>
  mockReadFile.mockImplementation(async (location: string) => {
    const content = contents[location];
    if (typeof content === 'string') {
      return content;
    }
    throw content ?? new Error(`ENOENT: ${location}`);
  });

describe('pickDatabaseFile', () => {
  beforeEach(() => {
    mockPick.mockReset();
    mockKeepLocalCopy.mockReset();
    mockReadFile.mockReset();
  });

  it('reads the local copy of the file as text', async () => {
    chooses();
    copySucceeds();
    files({[LOCAL_PATH]: '{"corporations": {}}'});

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
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith(LOCAL_PATH, 'utf8');
  });

  it('does not use fetch, which cannot read files on the device', async () => {
    chooses();
    copySucceeds();
    files({[LOCAL_PATH]: '{}'});
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await pickDatabaseFile();

    global.fetch = originalFetch;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets the user choose any kind of file, because file managers disagree on what JSON files are', async () => {
    chooses();
    copySucceeds();
    files({[LOCAL_PATH]: '{}'});

    await pickDatabaseFile();

    expect(mockPick).toHaveBeenCalledWith({type: [types.allFiles]});
  });

  it('names the copy even if the file has no name', async () => {
    chooses({name: null});
    copySucceeds();
    files({[LOCAL_PATH]: '{}'});

    expect(await pickDatabaseFile()).toMatchObject({ok: true, name: undefined});
    expect(mockKeepLocalCopy.mock.calls[0][0].files[0].fileName).toBe(
      'database.json',
    );
  });

  it('reads the copy as an address if reading it as a path fails', async () => {
    chooses();
    copySucceeds();
    files({[LOCAL_PATH]: new Error('ENOENT'), [LOCAL_URI]: '{"a": 1}'});

    expect(await pickDatabaseFile()).toMatchObject({
      ok: true,
      text: '{"a": 1}',
    });
    expect(mockReadFile.mock.calls.map(c => c[0])).toEqual([
      LOCAL_PATH,
      LOCAL_URI,
    ]);
  });

  it('reads the original address if the copy cannot be read at all', async () => {
    chooses();
    copySucceeds();
    files({[SOURCE]: '{"a": 1}'});

    expect(await pickDatabaseFile()).toMatchObject({
      ok: true,
      text: '{"a": 1}',
    });
    expect(mockReadFile.mock.calls.map(c => c[0])).toEqual([
      LOCAL_PATH,
      LOCAL_URI,
      SOURCE,
    ]);
  });

  describe('if no local copy can be made', () => {
    it('reads the original address when the copy is reported as failed', async () => {
      chooses();
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'error', copyError: 'no space', sourceUri: SOURCE},
      ]);
      files({[SOURCE]: '{"a": 1}'});

      expect(await pickDatabaseFile()).toMatchObject({
        ok: true,
        text: '{"a": 1}',
      });
      expect(mockReadFile.mock.calls.map(c => c[0])).toEqual([SOURCE]);
    });

    it('reads the original address when making the copy throws', async () => {
      chooses();
      mockKeepLocalCopy.mockRejectedValue(new Error('not linked'));
      files({[SOURCE]: '{"a": 1}'});

      expect(await pickDatabaseFile()).toMatchObject({
        ok: true,
        text: '{"a": 1}',
      });
    });
  });

  it('keeps special characters of the path of the copy decoded, and tolerates broken ones', async () => {
    chooses();
    mockKeepLocalCopy.mockResolvedValue([
      {
        status: 'success',
        localUri: 'file:///data/100%.json',
        sourceUri: SOURCE,
      },
    ]);
    files({'/data/100%.json': '{}'});

    expect(await pickDatabaseFile()).toMatchObject({ok: true});
  });

  it('treats an empty file as a failure and tries the other ways', async () => {
    chooses();
    copySucceeds();
    files({[LOCAL_PATH]: '', [SOURCE]: '{"a": 1}'});

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
    files({[SOURCE]: new Error('EACCES: Permission denied')});

    expect(await pickDatabaseFile()).toEqual({
      ok: false,
      error: 'READ_FAILED',
      detail: 'copy: permission denied; direct: EACCES: Permission denied',
    });
  });

  it('reports every attempt, with the error code of the problem if there is one', async () => {
    chooses();
    copySucceeds();
    files({
      [LOCAL_PATH]: Object.assign(new Error('No such file'), {code: 'ENOENT'}),
      [LOCAL_URI]: new Error('bad uri'),
      [SOURCE]: new Error('not allowed'),
    });

    expect(await pickDatabaseFile()).toEqual({
      ok: false,
      error: 'READ_FAILED',
      detail:
        'local path: ENOENT: No such file; local uri: bad uri; direct: not allowed',
    });
  });

  it.each([
    ['an error code', {code: 'OPERATION_CANCELED', message: 'x'}],
    ['an error message', new Error('User canceled document picker')],
  ])(
    'recognises that the user closed the picker by %s',
    async (_how, error) => {
      mockPick.mockRejectedValue(error);

      expect(await pickDatabaseFile()).toEqual({ok: false, error: 'CANCELLED'});
      expect(mockKeepLocalCopy).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
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

    expect(await pickDatabaseFile()).toEqual({ok: false, error: 'TOO_LARGE'});
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('leaves the exact size limit to the validation of the content', async () => {
    chooses({size: MAX_DATABASE_LENGTH * 2});
    copySucceeds();
    files({[LOCAL_PATH]: '{}'});

    expect(await pickDatabaseFile()).toMatchObject({ok: true});
  });
});
