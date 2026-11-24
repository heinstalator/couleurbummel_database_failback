import testDatabase from '../../resources/testDatabase.json';
import {looksLikeUrl, readDatabase} from '../../src/model/import';
import {MAX_DATABASE_LENGTH} from '../../src/model/validation';

const json = JSON.stringify(testDatabase);

const mockFetch = (response: Partial<Response> | Error) => {
  const fetchMock = jest.fn().mockImplementation(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve({
          ok: true,
          status: 200,
          headers: {get: () => null},
          text: () => Promise.resolve(json),
          ...response,
        }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe('looksLikeUrl', () => {
  it.each([
    'https://example.com/db.json',
    'HTTP://example.com',
    ' https://a.b/c ',
  ])('recognises %p', input => expect(looksLikeUrl(input)).toBe(true));

  it.each(['{"a": 1}', 'example.com/db.json', 'https://a b', ''])(
    'does not mistake %p for an address',
    input => expect(looksLikeUrl(input)).toBe(false),
  );
});

describe('readDatabase', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses pasted JSON without any network access', async () => {
    const fetchMock = mockFetch(new Error('should not be called'));

    const result = await readDatabase(`  ${json}\n`);

    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads and parses a database from an https address', async () => {
    const fetchMock = mockFetch({});

    const result = await readDatabase('https://example.com/db.json');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/db.json',
      expect.objectContaining({headers: {Accept: 'application/json'}}),
    );
  });

  it('refuses plain http addresses without connecting', async () => {
    const fetchMock = mockFetch({});

    expect(await readDatabase('http://example.com/db.json')).toEqual({
      ok: false,
      error: 'DOWNLOAD_FAILED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failed requests', async () => {
    mockFetch({ok: false, status: 404});
    expect(await readDatabase('https://example.com/db.json')).toEqual({
      ok: false,
      error: 'DOWNLOAD_FAILED',
    });

    mockFetch(new Error('Network request failed'));
    expect(await readDatabase('https://example.com/db.json')).toEqual({
      ok: false,
      error: 'DOWNLOAD_FAILED',
    });
  });

  it('refuses files that announce a size that is too large', async () => {
    mockFetch({headers: {get: () => String(MAX_DATABASE_LENGTH + 1)} as any});

    expect(await readDatabase('https://example.com/db.json')).toEqual({
      ok: false,
      error: 'TOO_LARGE',
    });
  });

  it('validates what it downloaded', async () => {
    mockFetch({text: () => Promise.resolve('<html>Not found</html>')});

    expect(await readDatabase('https://example.com/db.json')).toEqual({
      ok: false,
      error: 'INVALID_JSON',
    });
  });
});
