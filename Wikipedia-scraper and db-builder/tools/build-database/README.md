# Database builder

Builds a Couleurbummel database from spreadsheets. You fill in one row per corporation, and the tool writes a JSON file
in the format of `resources/couleurbummel.schema.json` and `resources/testDatabase.json`. You can import that file in
the app (see [Using the result in the app](#using-the-result-in-the-app)).

It needs Node.js 18 or newer and nothing else.

## Quick start

1. Copy `corporations.template.csv` (and, if you want your own organisations, `organisations.template.csv`) and open the
   copy in a spreadsheet program. The templates contain made-up example corporations to show the format.
2. Replace the examples with your data and export as CSV (UTF-8). Commas, semicolons and tabs are all fine, so the
   export of a German spreadsheet program works as it is.
3. Build the database:

```shell
node tools/build-database/build-database.js my-corporations.csv \
  --organisations my-organisations.csv \
  --out database.json
```

`examples/database.example.json` is what the two templates build into, if you want to see the result first.

The tool reports all problems at once, with the number of the row they are in (the header is row 1), and writes nothing
unless the whole file is fine.

To collect the corporations from Wikipedia instead of typing them, see
[`tools/wikipedia-import`](../wikipedia-import/README.md).

## Corporations file

One row per corporation. Only `shortName`, `city` and `country` are required, plus coordinates (see below). Column names
are not case-sensitive, and the tool warns about columns it doesn't know, which helps to find typos.

| Column                                                                     | Meaning                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                       | Optional. Made from country, city and short name if empty, like `corporation_de_aachen_kdstv_bergland`.             |
| `shortName`                                                                | Required. The short name, e.g. `KDStV Bergland`.                                                                    |
| `longName`                                                                 | The full name. Defaults to the short name.                                                                          |
| `street`                                                                   | Street and number. Corporations with the same street, postal code and city share one map pin.                       |
| `postalCode`                                                               | The postal code.                                                                                                    |
| `city`                                                                     | Required. The name of the city as it should be shown.                                                               |
| `country`                                                                  | Required. ISO code such as `DE`, `AT` or `CH`. `Deutschland`, `Österreich` and `Schweiz` work as well.              |
| `latitude`                                                                 | Where to put the pin, e.g. `50.7762` or `50,7762`. Both coordinates or none.                                        |
| `longitude`                                                                | See above.                                                                                                          |
| `addressName`                                                              | The name of the house, if it has one.                                                                               |
| `organisations`                                                            | Abbreviations of organisations, separated by `\|`, e.g. `CV\|KV`.                                                   |
| `indicatorColour`                                                          | The colour of the pin, e.g. `green`. Defaults to the colour of the first organisation that has one, otherwise grey. |
| `coloursPrinciple`                                                         | 0 unknown, 1 no colours, 2 needles, 3 not wearing, 4 optional, 5 mandatory. Words: see below.                       |
| `fencingPrinciple`                                                         | 0 unknown, 1 not fencing, 2 opt-in, 3 training mandatory but mensur optional, 4 mensur mandatory.                   |
| `foundationDate`                                                           | `1910`, `1910-05-23` or `23.05.1910`.                                                                               |
| `motto`, `jourFixe`, `mail`, `phone`, `website`, `remark`, `postalAddress` | Free text.                                                                                                          |
| `colours`                                                                  | The couleur, see below.                                                                                             |
| `hidden`                                                                   | `yes` to keep the corporation in the data but not show it in the app.                                               |

Instead of numbers, the principles accept some words: for `coloursPrinciple` `unknown`, `none`, `needle`,
`not wearing`, `optional` (or `fakultativ`) and `mandatory`; for `fencingPrinciple` `unknown`, `no` (or
`nichtschlagend`), `optional` (or `fakultativ`), `training`, `mandatory` (or `pflichtschlagend`).

### Colours

A corporation can have several couleurs (sashes). Separate them with `|`. Within one, list the stripes from top to
bottom, separated by `-`. A base colour can be added with `@` and a percussion with `+`:

```
blue-white-red                      one sash with three stripes
blue-white-red@black+gold           the same on a black base, with a gold percussion
blue-white-red|white-blue-white     two sashes
```

Known colours: `black`, `white`, `blue`, `blue_dark`, `blue_light`, `green`, `green_dark`, `green_light`, `green_moss`,
`red`, `red_dark`, `red_bordeaux`, `red_crimson`, `red_wine`, `orange`, `yellow`, `gold`, `silver`, `grey`,
`grey_light`, `pink`, `purple` and `brown`. German names work too (`schwarz`, `weiß`, `blau`, `grün`, `rot`, `gelb`,
`silber`, `grau`, `rosa`, `lila`, `braun`) and shades can be written either way round (`blau_dunkel`, `dark blue`).
A colour that isn't known is reported with this list. To add colours, edit the `COLOURS` list at the top of
`build-database.js`. The colour search in the app groups colours into families, which the tool takes care of.

## Organisations file

Optional. One row per organisation, with the columns `abbreviation`, `name` and `indicatorColour` (the pin colour of its
members, such as `green`). If a corporation names an organisation that isn't in the file, the tool creates it, uses the
abbreviation as its name and warns you.

## Coordinates

The pins need coordinates. Either fill in `latitude` and `longitude`, or let the tool look them up:

```shell
node tools/build-database/build-database.js my-corporations.csv --geocode --contact you@example.org
```

This asks OpenStreetMap's [Nominatim](https://nominatim.org/release-docs/latest/api/Search/) service for the rows that
have no coordinates. Its usage policy requires you to identify yourself, hence `--contact`, and allows one request per
second, which the tool respects. Answers are saved next to your CSV file in `<name>.csv.geocode-cache.json`, so every
address is only looked up once. Check the pins on the map afterwards: street addresses are sometimes placed a few
houses off, and the data is © OpenStreetMap contributors.

Rows that only have a city can't be looked up, because that would put the pin in the middle of the town. They need a
street, or coordinates.

The geocoding is covered by tests with a simulated service. It has not been tried against the real one.

### Leaving out corporations that can't be placed

With a large collection, such as the one from Wikipedia, many rows will have no coordinates and no street. Instead of
failing, the tool can set them aside:

```shell
node tools/build-database/build-database.js corporations.csv --skip-unlocated --skipped-out still-missing.csv
```

The database then only contains the corporations that can be placed. `still-missing.csv` has the left-out rows in the same
format, so you can complete them, paste them back into your file and build again. A corporation without coordinates that
shares its address with one that has them is not left out.

## What it writes

A JSON database with these tables: `corporations`, `addresses`, `cities`, `countries`, `organisations`, `colours` and
`colourFamilies`. The tool does not write events or points of interest. The output is the same every time for the same
input. Notes:

- IDs of corporations, cities and countries are made from their names, in the same way as in the existing database.
  The IDs of addresses (`address_aachen_0`, …) count up per city in the order of the rows.
- The couleur of a corporation uses `percussionColourId`, which is the name the app reads. The schema file calls it
  `percussion`.

## Using the result in the app

If the app can't use the online database, for example because the integrity check fails, **Settings** shows a
**Database** section with an **Import database** button. There are three ways to give the app your database:

- **Choose file…** opens the file picker of your phone. Put `database.json` on the phone first, for example by copying it
  into the Downloads folder (`adb push database.json /sdcard/Download/`), or through a cloud drive or a messenger.
- **Paste** the content of the file into the text field.
- Enter an **`https://`** address that serves the file.

The app checks the data before it uses it, and keeps it on the device. A database may be at most 5 million characters
long. For large databases, choosing a file is more reliable than pasting.

On Linux, `xclip -selection clipboard < database.json` copies the file to the clipboard.

## Tests

`yarn test __tests__/tools` runs the tests of the tool. They also build the templates and check the result with the
same validation the app uses when importing, and load it into the app's model.
