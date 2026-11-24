import AsyncStorage from '@react-native-async-storage/async-storage';

import constants from './constants';
import log from './log';
import {Database, parseDatabase} from './model/validation';
import {
  GlobalState,
  Language,
  SortOptions,
  StoredFavourites,
  Theme,
  UIState,
  UserSettings,
} from './types/state';
import {arraysEqual} from './util';

const favouritesKey = '@globalState/v1/favourites';
const sortOptionsKey = '@globalState/v1/sort';
const uiStateKey = '@globalState/v1/uiState';
const settingsKey = '@globalState/v1/userSettings';
const customDatabaseKey = '@customDatabase/v1';

const defaultState = {...constants.defaultState};

const writeObjectToStorage = async (key: string, value: any) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    log.error('Failed to write object', e);
  }
};

type ParseResult<T> =
  | {parsed: T; hasError: false; error?: undefined}
  | {parsed?: undefined; hasError: true; error?: unknown};

const safeJsonParse =
  <T extends any>(typeguard: (o: any) => o is T) =>
  (text: string): ParseResult<T> => {
    try {
      const parsed = JSON.parse(text);
      return typeguard(parsed) ? {parsed, hasError: false} : {hasError: true};
    } catch (error) {
      return {hasError: true, error};
    }
  };

const getObjectFromStorage = async <T>(
  key: string,
  defaults: T,
  typeguard: (o: any) => o is T,
) => {
  try {
    const maybeJSON = await AsyncStorage.getItem(key);

    if (maybeJSON == null) {
      log.debug(
        `Tried to read an object from storage that didn't exist. Key: ${key}`,
      );
      await writeObjectToStorage(key, defaults);
      return defaults;
    }

    const result = safeJsonParse(typeguard)(maybeJSON);
    if (result.hasError) {
      log.debug(
        `Couldn't parse stored JSON for key '${key}' into object`,
        result,
        maybeJSON,
      );
      await writeObjectToStorage(key, defaults);
      return defaults;
    }

    log.debug('Retrieved object', result.parsed);
    return result.parsed;
  } catch (e) {
    log.error(`Failed to retrieve object for key '${key}'`, e);
  }
  return defaults;
};

export const persistGlobalState = async (state: GlobalState) => {
  const favouriteArrays: StoredFavourites = {
    city: Array.from(state.favourites.city),
    corporation: Array.from(state.favourites.corporation),
  };

  log.debug('Persisting favourites:', favouriteArrays);
  await writeObjectToStorage(favouritesKey, favouriteArrays);

  log.debug('Persisting sort options:', state.corporationSorting);
  await writeObjectToStorage(sortOptionsKey, state.corporationSorting);

  log.debug('Persisting settings:', state.settings);
  await writeObjectToStorage(sortOptionsKey, state.settings);

  log.debug('Persisting UI state:', state.uiState);
  await writeObjectToStorage(uiStateKey, state.uiState);
};

export const getGlobalState: () => Promise<GlobalState> = async () => {
  log.debug('Loading state');
  const favourites = await getObjectFromStorage(
    favouritesKey,
    {
      city: Array.from(defaultState.favourites.city),
      corporation: Array.from(defaultState.favourites.corporation),
    } as StoredFavourites,
    isStoredFavourites,
  );

  const sortOptions = await getObjectFromStorage(
    sortOptionsKey,
    defaultState.corporationSorting,
    isSortOptions,
  );

  const uiState = await getObjectFromStorage(
    uiStateKey,
    constants.defaultState.uiState,
    isUIState,
  );

  const settings = await getObjectFromStorage(
    settingsKey,
    constants.defaultState.settings,
    isSettings,
  );

  return {
    favourites: {
      city: new Set(favourites.city),
      corporation: new Set(favourites.corporation),
    },
    corporationSorting: sortOptions,
    uiState,
    settings,
  };
};

const isSortOptions = (o: any): o is SortOptions => {
  const expectedKeys = [
    'Cities',
    'Countries',
    'Closest',
    'Search',
    'Organisations',
  ];

  return o && expectedKeys.every(key => key in o);
};

const isStoredFavourites = (o: any): o is StoredFavourites =>
  o && 'city' in o && 'corporation' in o;

const isUIState = (o: any): o is UIState => {
  const allowedValues = [
    'Map',
    'ExploreNearby',
    'ExploreSearch',
    'ExploreCities',
    'ExploreCountries',
    'ExploreOrganisations',
    'Settings',
  ];

  return !!o && allowedValues.indexOf(o.screenName) !== -1;
};

const isSettings = (o: any): o is UserSettings => {
  if (!o) {
    return false;
  }

  const requiredKeys = ['language', 'theme'];

  if (!arraysEqual(Object.keys(o), requiredKeys, true)) {
    return false;
  }

  if (requiredKeys.some(key => o[key] === undefined || o[key] === null)) {
    return false;
  }

  if (!Language[o.language]) {
    return false;
  }

  return !!Theme[o.theme];
};

/**
 * Stores a database that the user imported, so that it can be used when the online database is unavailable
 *
 * @param database - the validated database
 * @returns true if the database was stored
 */
export const saveCustomDatabase = async (database: Database) => {
  try {
    await AsyncStorage.setItem(customDatabaseKey, JSON.stringify(database));
    return true;
  } catch (e) {
    log.error('Failed to store the imported database', e);
    return false;
  }
};

/**
 * Gets the database that the user imported, if any
 *
 * The stored data is validated again, so a corrupted or outdated entry is ignored instead of breaking the app.
 */
export const loadCustomDatabase = async (): Promise<Database | undefined> => {
  try {
    const text = await AsyncStorage.getItem(customDatabaseKey);

    if (!text) {
      return undefined;
    }

    const result = parseDatabase(text);
    if (!result.ok) {
      log.warn('Ignoring the stored database, which is invalid', result);
      return undefined;
    }

    return result.database;
  } catch (e) {
    log.error('Failed to load the imported database', e);
    return undefined;
  }
};

/**
 * Removes the database that the user imported
 *
 * @returns true if no imported database is stored anymore
 */
export const removeCustomDatabase = async () => {
  try {
    await AsyncStorage.removeItem(customDatabaseKey);
    return true;
  } catch (e) {
    log.error('Failed to remove the imported database', e);
    return false;
  }
};
