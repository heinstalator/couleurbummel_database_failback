import '@react-native-firebase/app-check';
import '@react-native-firebase/database';

import firebase from '@react-native-firebase/app';
import {Dialog, Text} from '@rneui/themed';
import React, {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {useTranslation} from 'react-i18next';
import Config from 'react-native-config';

import testDatabase from '../../../resources/testDatabase.json';
import log from '../../log';
import {ImportResult, readDatabase} from '../../model/import';
import {CouleurbummelModel} from '../../model/model';
import {
  loadCustomDatabase,
  removeCustomDatabase as removeStoredDatabase,
  saveCustomDatabase,
} from '../../storage';

/**
 * Context providing the latest available model
 *
 * The app subscribes to database updates and immediately updates the model. This context can be used by components to
 * listen to model updates.
 */
export const ModelContext = React.createContext(new CouleurbummelModel());

/**
 * Information about the database in use and the means to replace it with the user's own database
 *
 * The online database can't be used if the app's integrity can't be verified. In that case, users can import their own
 * database, which the app then uses instead.
 */
export interface DatabaseContextValue {
  /** True if the online database can't be used on this device */
  remoteUnavailable: boolean;
  /** True if the user has imported a database, whether or not it's being used right now */
  hasCustomDatabase: boolean;
  /** True if the model comes from the imported database */
  usingCustomDatabase: boolean;
  /**
   * Imports a database and starts using it if the online database is unavailable
   *
   * @param input - the database as JSON or the https address of a JSON file
   */
  importDatabase: (input: string) => Promise<ImportResult>;
  /** Deletes the imported database */
  removeCustomDatabase: () => Promise<void>;
}

export const DatabaseContext = React.createContext<DatabaseContextValue>({
  remoteUnavailable: false,
  hasCustomDatabase: false,
  usingCustomDatabase: false,
  importDatabase: async () => ({ok: false, error: 'STORAGE_FAILED'}),
  removeCustomDatabase: async () => {},
});

const usesOnlineDatabase = () => Config.DATABASE_TYPE === 'prod';

const activateAppCheck = async () => {
  await firebase.appCheck().activate('ignored', true);
  const {token} = await firebase.appCheck().getToken();
  if (!token) {
    throw new Error('Did not receive an App Check token');
  }
  return token;
};

export const ModelContextProvider = ({children}: PropsWithChildren) => {
  const [appCheckErrorVisible, setAppCheckErrorVisible] = useState(false);
  const {t} = useTranslation();

  // The model built from the online database, or from the test database when not running in production
  const [remoteModel, setRemoteModel] = useState<CouleurbummelModel>(() =>
    usesOnlineDatabase()
      ? new CouleurbummelModel()
      : new CouleurbummelModel(testDatabase),
  );
  // The model built from the database the user imported
  const [customModel, setCustomModel] = useState<CouleurbummelModel>();
  // Whether the integrity check or access to the online database failed
  const [remoteUnavailable, setRemoteUnavailable] = useState(false);

  useEffect(() => {
    if (!usesOnlineDatabase()) {
      log.debug('Using mock database');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const start = async () => {
      const [storedDatabase, integrityVerified] = await Promise.all([
        loadCustomDatabase(),
        activateAppCheck().then(
          () => true,
          e => {
            log.error('Error activating App Check', e);
            return false;
          },
        ),
      ]);

      if (cancelled) {
        return;
      }

      if (storedDatabase) {
        setCustomModel(new CouleurbummelModel(storedDatabase));
      }

      if (!integrityVerified) {
        setRemoteUnavailable(true);

        if (storedDatabase) {
          log.info('Using the imported database instead of the online one');
          return;
        }
        setAppCheckErrorVisible(true);
      }

      log.debug('Subscribing to database updates');
      const db = firebase.app().database(Config.DATABASE_URL);
      const ref = db.ref(Config.DATABASE_PATH);

      const onValue = (snap: {val: () => any}) => {
        log.debug('Database update received');
        setRemoteModel(new CouleurbummelModel(snap.val()));
      };

      ref.on('value', onValue, err => {
        log.error(err);
        setRemoteUnavailable(true);
      });
      unsubscribe = () => ref.off('value', onValue);

      db.setPersistenceEnabled(true);
    };

    start().catch(e => log.error('Failed to load the database', e));

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const importDatabase = useCallback(async (input: string) => {
    const result = await readDatabase(input);
    if (!result.ok) {
      return result;
    }

    if (!(await saveCustomDatabase(result.database))) {
      return {ok: false, error: 'STORAGE_FAILED'} as const;
    }

    setCustomModel(new CouleurbummelModel(result.database));
    return result;
  }, []);

  const removeCustomDatabase = useCallback(async () => {
    await removeStoredDatabase();
    setCustomModel(undefined);
  }, []);

  const usingCustomDatabase = remoteUnavailable && customModel !== undefined;
  const model = usingCustomDatabase ? customModel : remoteModel;

  const databaseContext = useMemo(
    () => ({
      remoteUnavailable,
      hasCustomDatabase: customModel !== undefined,
      usingCustomDatabase,
      importDatabase,
      removeCustomDatabase,
    }),
    [
      remoteUnavailable,
      customModel,
      usingCustomDatabase,
      importDatabase,
      removeCustomDatabase,
    ],
  );

  return (
    <DatabaseContext.Provider value={databaseContext}>
      <ModelContext.Provider value={model}>
        {children}
        <Dialog isVisible={appCheckErrorVisible}>
          <Dialog.Title title={t('APP_CHECK_DIALOGUE_TITLE')} />
          <Text>{t('APP_CHECK_DIALOGUE_TEXT')}</Text>
          <Dialog.Actions>
            <Dialog.Button
              title={t('APP_CHECK_DIALOGUE_BUTTON_TEXT')}
              onPress={() => setAppCheckErrorVisible(false)}
            />
          </Dialog.Actions>
        </Dialog>
      </ModelContext.Provider>
    </DatabaseContext.Provider>
  );
};
