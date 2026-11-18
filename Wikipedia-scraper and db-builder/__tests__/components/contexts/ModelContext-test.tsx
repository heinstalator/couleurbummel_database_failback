import '../../../src/i18n';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {ThemeProvider} from '@rneui/themed';
import {act, render, screen, waitFor} from '@testing-library/react-native';
import React, {useContext} from 'react';
import {Keyboard} from 'react-native';

import testDatabase from '../../../resources/testDatabase.json';
import {
  DatabaseContext,
  DatabaseContextValue,
  ModelContext,
  ModelContextProvider,
} from '../../../src/components/contexts/ModelContext';
import {CouleurbummelModel} from '../../../src/model/model';
import {theme} from '../../../src/style/themes';

// Run the provider as it does in production, with a mocked Firebase
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    DATABASE_TYPE: 'prod',
    DATABASE_URL: 'https://example.firebaseio.com',
    DATABASE_PATH: '/database',
  },
}));

const mockActivate = jest.fn();
const mockGetToken = jest.fn();
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockSetPersistenceEnabled = jest.fn();

jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  default: {
    appCheck: () => ({
      activate: (...args: unknown[]) => mockActivate(...args),
      getToken: () => mockGetToken(),
    }),
    app: () => ({
      database: () => ({
        ref: () => ({
          on: (...args: unknown[]) => mockOn(...args),
          off: (...args: unknown[]) => mockOff(...args),
        }),
        setPersistenceEnabled: (...args: unknown[]) =>
          mockSetPersistenceEnabled(...args),
      }),
    }),
  },
}));

const storageKey = '@customDatabase/v1';

const customDatabase = {
  addresses: {
    address_custom: {
      id: 'address_custom',
      latitude: 50.1,
      longitude: 6.1,
      corporationIds: ['corporation_custom'],
    },
  },
  corporations: {
    corporation_custom: {
      id: 'corporation_custom',
      shortName: 'Custom',
      longName: 'Custom corporation',
      addressId: 'address_custom',
      coloursPrinciple: 1,
      fencingPrinciple: 1,
    },
  },
};

let current: {model: CouleurbummelModel; database: DatabaseContextValue};

const Probe = () => {
  current = {
    model: useContext(ModelContext),
    database: useContext(DatabaseContext),
  };
  return null;
};

const renderProvider = () =>
  render(
    <ThemeProvider theme={theme}>
      <ModelContextProvider>
        <Probe />
      </ModelContextProvider>
    </ThemeProvider>,
  );

const integrityFails = () => {
  mockActivate.mockRejectedValue(new Error('Integrity check failed'));
};

const integrityPasses = () => {
  mockActivate.mockResolvedValue(undefined);
  mockGetToken.mockResolvedValue({token: 'token'});
};

/** Delivers a snapshot of the online database to the listener the provider registered */
const deliverOnlineDatabase = (db: object) =>
  act(() => mockOn.mock.calls[0][1]({val: () => db}));

describe('ModelContextProvider with the online database', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // The jest mock of the keyboard returns no subscription, which the dialog expects when it is unmounted
    jest
      .spyOn(Keyboard, 'addListener')
      .mockReturnValue({remove: jest.fn()} as any);
    await AsyncStorage.clear();
  });

  it('uses the online database if the integrity check passes', async () => {
    integrityPasses();
    renderProvider();

    await waitFor(() => expect(mockOn).toHaveBeenCalledTimes(1));
    deliverOnlineDatabase(testDatabase);

    expect(
      current.model.corporation('corporation_de_aachen_kdstv_bergland'),
    ).toBeDefined();
    expect(current.database.remoteUnavailable).toBe(false);
    expect(screen.queryByText('App integrity check failed')).toBeNull();
  });

  it('warns and still tries the online database if the check fails and nothing was imported', async () => {
    integrityFails();
    renderProvider();

    await screen.findByText('App integrity check failed');
    await waitFor(() => expect(mockOn).toHaveBeenCalledTimes(1));
    expect(current.database.remoteUnavailable).toBe(true);
    expect(current.database.hasCustomDatabase).toBe(false);
  });

  it('switches to a database imported after the check failed, and remembers it', async () => {
    integrityFails();
    renderProvider();
    await waitFor(() => expect(current.database.remoteUnavailable).toBe(true));

    let result;
    await act(async () => {
      result = await current.database.importDatabase(
        JSON.stringify(customDatabase),
      );
    });

    expect(result).toMatchObject({ok: true, corporations: 1});
    expect(current.database.usingCustomDatabase).toBe(true);
    expect(current.model.corporation('corporation_custom')?.shortName).toBe(
      'Custom',
    );
    expect(await AsyncStorage.getItem(storageKey)).not.toBeNull();
  });

  it('does not store or use a database that is invalid', async () => {
    integrityFails();
    renderProvider();
    await waitFor(() => expect(current.database.remoteUnavailable).toBe(true));

    let result;
    await act(async () => {
      result = await current.database.importDatabase('{"corporations": {}}');
    });

    expect(result).toMatchObject({ok: false});
    expect(current.database.hasCustomDatabase).toBe(false);
    expect(await AsyncStorage.getItem(storageKey)).toBeNull();
  });

  it('uses a stored database right away, without a warning or the online database, if the check fails', async () => {
    await AsyncStorage.setItem(storageKey, JSON.stringify(customDatabase));
    integrityFails();
    renderProvider();

    await waitFor(() =>
      expect(current.database.usingCustomDatabase).toBe(true),
    );
    expect(current.model.corporation('corporation_custom')).toBeDefined();
    expect(screen.queryByText('App integrity check failed')).toBeNull();
    expect(mockOn).not.toHaveBeenCalled();
  });

  it('prefers the online database over a stored one when the check passes', async () => {
    await AsyncStorage.setItem(storageKey, JSON.stringify(customDatabase));
    integrityPasses();
    renderProvider();

    await waitFor(() => expect(mockOn).toHaveBeenCalledTimes(1));
    deliverOnlineDatabase(testDatabase);

    await waitFor(() => expect(current.database.hasCustomDatabase).toBe(true));
    expect(current.database.usingCustomDatabase).toBe(false);
    expect(current.model.corporation('corporation_custom')).toBeUndefined();
    expect(
      current.model.corporation('corporation_de_aachen_kdstv_bergland'),
    ).toBeDefined();
  });

  it('falls back to a stored database if access to the online database is denied', async () => {
    await AsyncStorage.setItem(storageKey, JSON.stringify(customDatabase));
    integrityPasses();
    renderProvider();

    await waitFor(() => expect(mockOn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(current.database.hasCustomDatabase).toBe(true));
    act(() => mockOn.mock.calls[0][2](new Error('permission-denied')));

    expect(current.database.usingCustomDatabase).toBe(true);
    expect(current.model.corporation('corporation_custom')).toBeDefined();
  });

  it('ignores a stored database that has become invalid', async () => {
    await AsyncStorage.setItem(storageKey, '{"corporations": []}');
    integrityFails();
    renderProvider();

    await screen.findByText('App integrity check failed');
    expect(current.database.hasCustomDatabase).toBe(false);
  });

  it('removes the imported database', async () => {
    await AsyncStorage.setItem(storageKey, JSON.stringify(customDatabase));
    integrityFails();
    renderProvider();
    await waitFor(() =>
      expect(current.database.usingCustomDatabase).toBe(true),
    );

    await act(async () => {
      await current.database.removeCustomDatabase();
    });

    expect(current.database.hasCustomDatabase).toBe(false);
    expect(current.model.corporation('corporation_custom')).toBeUndefined();
    expect(await AsyncStorage.getItem(storageKey)).toBeNull();
  });

  it('stops listening for updates when it is removed', async () => {
    integrityPasses();
    const {unmount} = renderProvider();
    await waitFor(() => expect(mockOn).toHaveBeenCalledTimes(1));

    unmount();

    expect(mockOff).toHaveBeenCalledWith('value', mockOn.mock.calls[0][1]);
  });
});
