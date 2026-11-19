import {Button, Dialog, Input, ListItem, makeStyles, Text} from '@rneui/themed';
import {TFunction} from 'i18next';
import React, {useContext, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {View} from 'react-native';

import {ImportResult} from '../model/import';
import {pickDatabaseFile} from '../model/pickDatabaseFile';
import {DatabaseContext} from './contexts/ModelContext';

const errorMessage = (
  result: Extract<ImportResult, {ok: false}>,
  t: TFunction,
) => {
  switch (result.error) {
    case 'INVALID_JSON':
      return t('DATABASE_ERROR_INVALID_JSON');
    case 'INCOMPLETE':
      return t('DATABASE_ERROR_INCOMPLETE');
    case 'INVALID_ENTRY':
      return t('DATABASE_ERROR_INVALID_ENTRY', {entry: result.entry});
    case 'TOO_LARGE':
      return t('DATABASE_ERROR_TOO_LARGE');
    case 'DOWNLOAD_FAILED':
      return t('DATABASE_ERROR_DOWNLOAD_FAILED');
    case 'STORAGE_FAILED':
      return t('DATABASE_ERROR_STORAGE_FAILED');
  }
};

/**
 * The part of the settings that lets users import their own database
 *
 * This is only shown if the online database can't be used on the device, for example because the integrity check
 * failed, or if the user has imported a database before and needs a way to remove it.
 */
export const DatabaseSettings = () => {
  const {t} = useTranslation();
  const styles = useStyles();

  const {
    remoteUnavailable,
    hasCustomDatabase,
    usingCustomDatabase,
    importDatabase,
    removeCustomDatabase,
  } = useContext(DatabaseContext);

  const [dialogVisible, setDialogVisible] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  if (!remoteUnavailable && !hasCustomDatabase) {
    return null;
  }

  let status = t('DATABASE_STATUS_UNAVAILABLE');
  if (usingCustomDatabase) {
    status = t('DATABASE_STATUS_IN_USE');
  } else if (hasCustomDatabase) {
    status = t('DATABASE_STATUS_STORED');
  }

  const closeDialog = () => {
    setDialogVisible(false);
    setError(undefined);
  };

  const runImport = async (text: string) => {
    setBusy(true);
    setError(undefined);

    const result = await importDatabase(text);

    setBusy(false);
    if (result.ok) {
      setDialogVisible(false);
      setInput('');
      setNotice(
        t('DATABASE_IMPORT_SUCCESS', {corporations: result.corporations}),
      );
    } else {
      setError(errorMessage(result, t));
    }
  };

  const onChooseFile = async () => {
    setBusy(true);
    setError(undefined);

    const picked = await pickDatabaseFile();

    setBusy(false);
    if (picked.ok) {
      await runImport(picked.text);
    } else if (picked.error === 'TOO_LARGE') {
      setError(t('DATABASE_ERROR_TOO_LARGE'));
    } else if (picked.error === 'READ_FAILED') {
      // The reason is shown, because it is the only way to find out why a particular phone can't read the file
      setError(
        `${t('DATABASE_ERROR_READ_FAILED')} (${picked.detail.slice(0, 300)})`,
      );
    }
    // If the user closed the picker, there is nothing to say
  };

  return (
    <View testID={'Settings:Database'}>
      <ListItem key={'settings_database'} bottomDivider>
        <ListItem.Content>
          <ListItem.Title>{t('DATABASE_TITLE')}</ListItem.Title>
          <ListItem.Subtitle>{status}</ListItem.Subtitle>
          {notice && <Text style={styles.notice}>{notice}</Text>}
        </ListItem.Content>
      </ListItem>

      <View style={styles.buttons}>
        <Button
          testID={'Settings:ImportDatabase'}
          title={t('DATABASE_IMPORT_BUTTON')}
          onPress={() => {
            setNotice(undefined);
            setDialogVisible(true);
          }}
        />
        {hasCustomDatabase && (
          <Button
            testID={'Settings:RemoveDatabase'}
            type={'outline'}
            title={t('DATABASE_REMOVE_BUTTON')}
            onPress={() => {
              setNotice(undefined);
              removeCustomDatabase();
            }}
          />
        )}
      </View>

      <Dialog
        testID={'Settings:ImportDialog'}
        isVisible={dialogVisible}
        onBackdropPress={busy ? undefined : closeDialog}>
        <Dialog.Title title={t('DATABASE_IMPORT_TITLE')} />
        <Text>{t('DATABASE_IMPORT_HELP')}</Text>
        <Button
          testID={'Settings:ChooseFile'}
          type={'outline'}
          title={t('DATABASE_IMPORT_CHOOSE_FILE')}
          disabled={busy}
          containerStyle={styles.chooseFile}
          onPress={onChooseFile}
        />
        <Input
          testID={'Settings:DatabaseInput'}
          multiline
          numberOfLines={6}
          autoCapitalize={'none'}
          autoCorrect={false}
          value={input}
          editable={!busy}
          placeholder={t('DATABASE_IMPORT_PLACEHOLDER')}
          errorMessage={error}
          onChangeText={text => {
            setInput(text);
            setError(undefined);
          }}
        />
        {busy && <Dialog.Loading />}
        <Dialog.Actions>
          <Dialog.Button
            testID={'Settings:ImportConfirm'}
            title={t('DATABASE_IMPORT_CONFIRM')}
            disabled={busy || !input.trim()}
            onPress={() => runImport(input)}
          />
          <Dialog.Button
            testID={'Settings:ImportCancel'}
            title={t('DATABASE_IMPORT_CANCEL')}
            disabled={busy}
            onPress={closeDialog}
          />
        </Dialog.Actions>
      </Dialog>
    </View>
  );
};

const useStyles = makeStyles(() => ({
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginVertical: 15,
    gap: 10,
  },
  notice: {
    marginTop: 8,
  },
  chooseFile: {
    marginVertical: 12,
  },
}));
