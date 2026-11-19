import '../../src/i18n';

import {ThemeProvider} from '@rneui/themed';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';
import {Keyboard} from 'react-native';

import {
  DatabaseContext,
  DatabaseContextValue,
} from '../../src/components/contexts/ModelContext';
import {DatabaseSettings} from '../../src/components/DatabaseSettings';
import {pickDatabaseFile} from '../../src/model/pickDatabaseFile';
import {theme} from '../../src/style/themes';

jest.mock('../../src/model/pickDatabaseFile', () => ({
  pickDatabaseFile: jest.fn(),
}));

const mockPickDatabaseFile = pickDatabaseFile as jest.Mock;

const renderSettings = (overrides: Partial<DatabaseContextValue> = {}) => {
  const value: DatabaseContextValue = {
    remoteUnavailable: false,
    hasCustomDatabase: false,
    usingCustomDatabase: false,
    importDatabase: jest.fn().mockResolvedValue({ok: true, corporations: 3}),
    removeCustomDatabase: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  render(
    <ThemeProvider theme={theme}>
      <DatabaseContext.Provider value={value}>
        <DatabaseSettings />
      </DatabaseContext.Provider>
    </ThemeProvider>,
  );

  return value;
};

const openDialogAndEnter = async (text: string) => {
  fireEvent.press(screen.getByTestId('Settings:ImportDatabase'));
  fireEvent.changeText(
    await screen.findByTestId('Settings:DatabaseInput'),
    text,
  );
};

describe('DatabaseSettings', () => {
  beforeEach(() => {
    // The jest mock of the keyboard returns no subscription, which the dialog expects when it is unmounted
    jest
      .spyOn(Keyboard, 'addListener')
      .mockReturnValue({remove: jest.fn()} as any);
  });

  it('is hidden while the online database works and nothing was imported', () => {
    renderSettings();

    expect(screen.queryByTestId('Settings:Database')).toBeNull();
    expect(screen.queryByText('Database')).toBeNull();
  });

  it('offers the import if the online database is unavailable', () => {
    renderSettings({remoteUnavailable: true});

    expect(screen.getByText(/isn't available on this device/)).toBeTruthy();
    expect(screen.getByTestId('Settings:ImportDatabase')).toBeTruthy();
    expect(screen.queryByTestId('Settings:RemoveDatabase')).toBeNull();
  });

  it('says that the imported database is in use and offers to remove it', () => {
    renderSettings({
      remoteUnavailable: true,
      hasCustomDatabase: true,
      usingCustomDatabase: true,
    });

    expect(screen.getByText(/using the database you imported/)).toBeTruthy();
    expect(screen.getByTestId('Settings:RemoveDatabase')).toBeTruthy();
  });

  it('stays available to remove an imported database that is currently not in use', () => {
    renderSettings({hasCustomDatabase: true});

    expect(
      screen.getByText(/only be used if the online database/),
    ).toBeTruthy();
    expect(screen.getByTestId('Settings:RemoveDatabase')).toBeTruthy();
  });

  it('removes the imported database', () => {
    const value = renderSettings({hasCustomDatabase: true});

    fireEvent.press(screen.getByTestId('Settings:RemoveDatabase'));

    expect(value.removeCustomDatabase).toHaveBeenCalledTimes(1);
  });

  it('imports what the user entered and reports the result', async () => {
    const value = renderSettings({remoteUnavailable: true});

    await openDialogAndEnter('  https://example.com/db.json ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('Settings:ImportConfirm'));
    });

    expect(value.importDatabase).toHaveBeenCalledWith(
      '  https://example.com/db.json ',
    );
    expect(
      await screen.findByText('Database imported. Corporations: 3'),
    ).toBeTruthy();
  });

  it('does not allow importing nothing', async () => {
    const value = renderSettings({remoteUnavailable: true});

    await openDialogAndEnter('   ');
    fireEvent.press(screen.getByTestId('Settings:ImportConfirm'));

    expect(value.importDatabase).not.toHaveBeenCalled();
  });

  it.each([
    [{ok: false, error: 'INVALID_JSON'}, /valid database in JSON format/],
    [
      {ok: false, error: 'INCOMPLETE'},
      /at least one address and one corporation/,
    ],
    [
      {ok: false, error: 'INVALID_ENTRY', entry: 'addresses/a1'},
      /entry "addresses\/a1" is invalid/,
    ],
    [{ok: false, error: 'TOO_LARGE'}, /too large/],
    [{ok: false, error: 'DOWNLOAD_FAILED'}, /Only https addresses work/],
    [{ok: false, error: 'STORAGE_FAILED'}, /couldn't be saved/],
  ])(
    'explains the failure %p and keeps the dialog open',
    async (result, message) => {
      const value = renderSettings({
        remoteUnavailable: true,
        importDatabase: jest.fn().mockResolvedValue(result),
      });

      await openDialogAndEnter('{}');
      await act(async () => {
        fireEvent.press(screen.getByTestId('Settings:ImportConfirm'));
      });

      expect(await screen.findByText(message)).toBeTruthy();
      expect(value.importDatabase).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('Settings:DatabaseInput')).toBeTruthy();
    },
  );

  it('closes the dialog without importing when cancelled', async () => {
    const value = renderSettings({remoteUnavailable: true});

    await openDialogAndEnter('{}');
    fireEvent.press(screen.getByTestId('Settings:ImportCancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('Settings:DatabaseInput')).toBeNull(),
    );
    expect(value.importDatabase).not.toHaveBeenCalled();
  });
});

describe('DatabaseSettings with a file', () => {
  beforeEach(() => {
    mockPickDatabaseFile.mockReset();
    jest
      .spyOn(Keyboard, 'addListener')
      .mockReturnValue({remove: jest.fn()} as any);
  });

  const openDialogAndChooseFile = async () => {
    fireEvent.press(screen.getByTestId('Settings:ImportDatabase'));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('Settings:ChooseFile'));
    });
  };

  it('imports the content of the file that was chosen and reports the result', async () => {
    mockPickDatabaseFile.mockResolvedValue({
      ok: true,
      text: '{"corporations": {}}',
      name: 'db.json',
    });
    const value = renderSettings({remoteUnavailable: true});

    await openDialogAndChooseFile();

    expect(value.importDatabase).toHaveBeenCalledWith('{"corporations": {}}');
    expect(
      await screen.findByText('Database imported. Corporations: 3'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByTestId('Settings:DatabaseInput')).toBeNull(),
    );
  });

  it('does nothing if the user closes the picker', async () => {
    mockPickDatabaseFile.mockResolvedValue({ok: false, error: 'CANCELLED'});
    const value = renderSettings({remoteUnavailable: true});

    await openDialogAndChooseFile();

    expect(value.importDatabase).not.toHaveBeenCalled();
    expect(screen.getByTestId('Settings:DatabaseInput')).toBeTruthy();
    expect(screen.queryByText(/couldn't be read|too large/)).toBeNull();
  });

  it.each([
    [
      {
        error: 'READ_FAILED',
        detail: 'copying: no space; direct: Network request failed',
      },
      /The file couldn't be read\. \(copying: no space; direct: Network request failed\)/,
    ],
    [{error: 'TOO_LARGE'}, /too large/],
  ])(
    'explains it when the file has the problem %p',
    async (problem, message) => {
      mockPickDatabaseFile.mockResolvedValue({ok: false, ...problem});
      const value = renderSettings({remoteUnavailable: true});

      await openDialogAndChooseFile();

      expect(await screen.findByText(message)).toBeTruthy();
      expect(value.importDatabase).not.toHaveBeenCalled();
    },
  );

  it('explains it when the content of the file cannot be used, and keeps the dialog open', async () => {
    mockPickDatabaseFile.mockResolvedValue({ok: true, text: 'not json'});
    const value = renderSettings({
      remoteUnavailable: true,
      importDatabase: jest
        .fn()
        .mockResolvedValue({ok: false, error: 'INVALID_JSON'}),
    });

    await openDialogAndChooseFile();

    expect(value.importDatabase).toHaveBeenCalledWith('not json');
    expect(
      await screen.findByText(/valid database in JSON format/),
    ).toBeTruthy();
    expect(screen.getByTestId('Settings:ChooseFile')).toBeTruthy();
  });

  it('still lets the user paste JSON or an address instead', async () => {
    const value = renderSettings({remoteUnavailable: true});

    fireEvent.press(screen.getByTestId('Settings:ImportDatabase'));
    fireEvent.changeText(
      await screen.findByTestId('Settings:DatabaseInput'),
      'https://example.com/db.json',
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('Settings:ImportConfirm'));
    });

    expect(mockPickDatabaseFile).not.toHaveBeenCalled();
    expect(value.importDatabase).toHaveBeenCalledWith(
      'https://example.com/db.json',
    );
  });
});
