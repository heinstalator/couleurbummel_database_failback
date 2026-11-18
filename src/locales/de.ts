import {Translation} from '../types/i18n';

const de: Translation = {
  SCREEN_MAP: 'Karte',
  SCREEN_CITIES: 'Städte',
  SCREEN_NEARBY: 'In der Nähe',
  SCREEN_COUNTRIES: 'Länder',
  SCREEN_SETTINGS: 'Einstellungen',
  SCREEN_ORGANISATIONS: 'Verbände',
  SCREEN_CORPORATION_LIST: 'Verbindungen',
  SCREEN_DETAILS: 'Details',
  SCREEN_SEARCH_NAME: 'Name',
  SCREEN_SEARCH_COLOURS: 'Farben',
  DISTANCE: '{{distanceString}} entfernt',
  SEARCH_BAR_PLACEHOLDER: 'Suche...',
  SORT_NAME: 'Name',
  SORT_DISTANCE: 'Entfernung',
  FENCING_UNKNOWN: 'unbekannt',
  FENCING_NO: 'nichtschlagend',
  FENCING_FREE: 'frei schlagend',
  FENCING_FACULTATIVELY: 'fakultativ schlagend',
  FENCING_MANDATORY: 'pflichtschlagend',
  COLOURS_UNKNOWN: 'unbekannt',
  COLOURS_NONE: 'keine Farben',
  COLOURS_NEEDLE: 'nadeltragend',
  COLOURS_NOT_WEARING: 'farbenführend',
  COLOURS_FACULTATIVELY: 'fakultativ farbentragend',
  COLOURS_YES: 'farbentragend',
  GITHUB: 'GitHub',
  DRAWER_EXPLORE: 'Erkunden',
  DRAWER_SEARCH: 'Suche',
  DRAWER_FAVOURITES: 'Favoriten',
  BUTTON_FAVOURITE: 'Favorit',
  LANGUAGE: 'Sprache',
  LANGUAGE_SYSTEM: 'Auto',
  THEME: 'Theme',
  THEME_AUTO: 'Auto',
  THEME_LIGHT: 'Hell',
  THEME_DARK: 'Dunkel',
  APP_CHECK_DIALOGUE_TITLE: 'Integritätsprüfung fehlgeschlagen',
  APP_CHECK_DIALOGUE_TEXT:
    'Das Gerät oder die App konnte nicht als echt verifiziert werden. Sie funktioniert möglicherweise nicht korrekt.' +
    '\n\n' +
    'Bitte stelle sicher, dass du die App aus dem Store installiert hast.' +
    '\n\n' +
    'Falls es trotzdem nicht funktioniert, kannst du in den Einstellungen eine eigene Datenbank importieren.',
  APP_CHECK_DIALOGUE_BUTTON_TEXT: 'Schließen',
  DATABASE_TITLE: 'Datenbank',
  DATABASE_STATUS_UNAVAILABLE:
    'Die Online-Datenbank ist auf diesem Gerät nicht verfügbar. Du kannst stattdessen eine eigene Datenbank importieren.',
  DATABASE_STATUS_IN_USE:
    'Die App verwendet die Datenbank, die du importiert hast.',
  DATABASE_STATUS_STORED:
    'Du hast eine Datenbank importiert. Sie wird nur verwendet, wenn die Online-Datenbank nicht verfügbar ist.',
  DATABASE_IMPORT_BUTTON: 'Datenbank importieren',
  DATABASE_REMOVE_BUTTON: 'Importierte Datenbank entfernen',
  DATABASE_IMPORT_TITLE: 'Datenbank importieren',
  DATABASE_IMPORT_HELP:
    'Wähle eine Datei mit der Datenbank, füge ihren Inhalt als JSON ein oder gib die https-Adresse einer JSON-Datei ein. Importiere nur Daten aus vertrauenswürdigen Quellen.',
  DATABASE_IMPORT_PLACEHOLDER: 'https://… oder {…}',
  DATABASE_IMPORT_CONFIRM: 'Importieren',
  DATABASE_IMPORT_CANCEL: 'Abbrechen',
  DATABASE_IMPORT_SUCCESS:
    'Datenbank importiert. Verbindungen: {{corporations}}',
  DATABASE_ERROR_INVALID_JSON:
    'Das ist keine gültige Datenbank im JSON-Format.',
  DATABASE_ERROR_INCOMPLETE:
    'Die Datenbank braucht mindestens eine Adresse und eine Verbindung.',
  DATABASE_ERROR_INVALID_ENTRY: 'Der Eintrag „{{entry}}“ ist ungültig.',
  DATABASE_ERROR_TOO_LARGE:
    'Die Datenbank ist zu groß, um auf diesem Gerät gespeichert zu werden.',
  DATABASE_ERROR_DOWNLOAD_FAILED:
    'Die Datei konnte nicht heruntergeladen werden. Es funktionieren nur https-Adressen.',
  DATABASE_ERROR_STORAGE_FAILED:
    'Die Datenbank konnte nicht auf diesem Gerät gespeichert werden.',
  DATABASE_IMPORT_CHOOSE_FILE: 'Datei auswählen …',
  DATABASE_ERROR_READ_FAILED: 'Die Datei konnte nicht gelesen werden.',
  CHANGE_REQUEST_SUBJECT: 'Änderungswunsch für {{name}}',
  SEARCH_COLOURS_ANY_COLOUR: 'irgendeine',
  SEARCH_COLOURS_ACCORDION: 'Sucheinstellungen',
  SEARCH_COLOURS_PARAMETER_BASE_COLOUR: 'Grundfarbe',
  SEARCH_COLOURS_PARAMETER_NUM_COLOURS: 'Anzahl Farben',
  SEARCH_COLOURS_DROPDOWN_BASE_COLOUR: 'Grundfarbe',
  SEARCH_COLOURS_DROPDOWN_COLOUR: 'Farbe {{index}}',
  DROPDOWN_PLACEHOLDER: 'Auswählen...',
  COLOUR_FAMILY_BLACK: 'schwarz',
  COLOUR_FAMILY_BLUE: 'blau',
  COLOUR_FAMILY_BROWN: 'braun',
  COLOUR_FAMILY_GOLD: 'gold',
  COLOUR_FAMILY_GREEN: 'grün',
  COLOUR_FAMILY_GREY: 'grau',
  COLOUR_FAMILY_ORANGE: 'orange',
  COLOUR_FAMILY_PINK: 'rosa',
  COLOUR_FAMILY_PURPLE: 'violett',
  COLOUR_FAMILY_RED: 'rot',
  COLOUR_FAMILY_SILVER: 'silber',
  COLOUR_FAMILY_WHITE: 'weiß',
  COLOUR_FAMILY_YELLOW: 'gelb',
};

export default de;
