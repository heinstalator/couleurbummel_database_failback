# Wikipedia import

Collects Studentenverbindungen from the German Wikipedia into the spreadsheets that
[`tools/build-database`](../build-database/README.md) turns into a database. It starts at the
[Liste der Listen von Studentenverbindungen](https://de.wikipedia.org/wiki/Liste_der_Listen_von_Studentenverbindungen),
reads the list of each city, and writes one row per corporation.

It needs Node.js 18 or newer and nothing else.

## What you get, and what you don't

From the tables of the lists the tool takes the name, the city, the country, the foundation date, the colours, the
association, the fencing principle ("Fechtfrage") and whether colours are worn. **Wikipedia's lists contain no addresses and no coordinates.** The
only way the tool can place a corporation on the map is `--coordinates`, which takes the coordinates from the
corporation's own article, where it has some. Expect many rows to stay without a location. They are not lost: the
builder can set them aside in a file that you complete by hand (see below).

> **Status:** A first run against the list of Aachen worked: it found 36 corporations in 2 tables, and I fixed the
> three things it didn't understand. Everything else is tested only against pages modelled on the real lists, so the other
> lists will probably show new colour words or fencing terms. The report tells you which, see
> [First run](#first-run).

## Quick start

```shell
# 1. Collect the corporations (a few minutes, mostly waiting politely between requests)
node tools/wikipedia-import/wikipedia-import.js --contact you@example.org --coordinates

# 2. Build the database from them, setting aside those that can't be placed on the map yet
node tools/build-database/build-database.js wikipedia-corporations.csv \
  --organisations wikipedia-organisations.csv \
  --skip-unlocated --skipped-out still-missing.csv \
  --out database.json
```

Then open `still-missing.csv`, fill in `street` and `postalCode` (and the `id`, if two corporations have the same
name) for the corporations you care about, paste those rows into `wikipedia-corporations.csv`, and build again with
`--geocode --contact you@example.org` added. The builder looks the addresses up on OpenStreetMap. Rows without a street
are never looked up, because that would put the pin in the middle of the town instead of at the house.

## First run

1. `--list-only` shows which lists were found and in which country each city was put, without reading them:
   ```shell
   node tools/wikipedia-import/wikipedia-import.js --contact you@example.org --list-only
   ```
   When I looked at the page, it linked about 90 city lists (73 German, 8 Austrian and 9 Swiss cities). If you see none,
   the links of the list of lists weren't recognised.
2. Try one city and read the report:
   ```shell
   node tools/wikipedia-import/wikipedia-import.js --contact you@example.org --cities Aachen --coordinates
   ```
   Open `wikipedia-report.txt`. Near the top, "Words that need your attention" lists the colour words and
   fencing terms that couldn't be read, with how often they occur. Add them to the tables at the top of
   `wikipedia-import.js` (or tell me). A warning like "no table of corporations was found" means a page has a layout the tool
   doesn't understand. Compare `wikipedia-corporations.csv` with the page on Wikipedia.
3. Then run everything.

Answers of Wikipedia are kept in `.wikipedia-cache/`, so repeating a run doesn't ask again. Use `--refresh` to ask
again.

## Options

| Option                           | Meaning                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--contact <email>`              | Required. Wikimedia asks every program to identify itself, so it's sent with each request.                          |
| `--out <file>`                   | The corporations (default `wikipedia-corporations.csv`).                                                            |
| `--organisations-out <file>`     | The organisations (default `wikipedia-organisations.csv`).                                                          |
| `--report <file>`                | What was found and what needs attention (default `wikipedia-report.txt`).                                           |
| `--cities <names>`               | Only these cities, separated by commas: `--cities Aachen,Bonn,Wien`.                                                |
| `--lists <regex>`                | Also read lists whose title matches, e.g. `"Liste der Burschenschaften"`. Their cities come from the `Sitz` column. |
| `--country "<City>=<XX>"`        | Sets the country of a city, e.g. `"Bern=CH"`. Can be repeated.                                                      |
| `--coordinates`                  | Takes coordinates from the corporations' own articles, where they have some.                                        |
| `--include-inactive`             | Keeps inactive corporations, marked as hidden.                                                                      |
| `--include-pupil`                | Keeps school fraternities (Schülerverbindungen).                                                                    |
| `--limit <n>`                    | Only reads the first n lists.                                                                                       |
| `--list-only`                    | Shows the lists and stops.                                                                                          |
| `--cache-dir <dir>`, `--refresh` | Where answers are kept (default `.wikipedia-cache`), and ignoring what was kept.                                    |
| `--index <title>`                | The list of lists to start from.                                                                                    |

## How it reads the lists

- **Which lists:** links of the list of lists with titles like "Liste der Studentenverbindungen in …" and "Liste der
  Studenten- und Schülerverbindungen in …". Further lists need `--lists`.
- **Countries:** Wikipedia's API doesn't say which country a city list belongs to. The tool knows the cities that the list
  of lists files under Austria and Switzerland (see the top of `wikipedia-import.js`) and assumes Germany for all others.
  `--list-only` shows what it decided, `--country` corrects it, and the report warns about cities from other lists
  whose country it doesn't know. A list that covers several cities ("Koblenz und Vallendar") uses the first one, and
  warns.
- **Tables:** found by their column names (`Name`, `Gründung`, `Farben`, `Verband`, `Fechtfrage`, and `Sitz`,
  `Wahlspruch` and `Status` where there are such columns), so the order of columns doesn't matter. Cells that span rows,
  repeated header rows, footnote marks and soft hyphens are handled.
- **Inactive corporations** (sections or status like "vertagt", "suspendiert", "ehemalig", "aufgelöst") and **school
  fraternities** are left out unless you ask for them. The report counts what was left out.
- **Duplicates:** a corporation that appears in several lists is kept once, if its name and city are written the same.
  Fields that are empty in the first list are taken from the later ones.
- **Names:** the name in the list is used as both short and long name. Shorten the short names where you like.
- **Foundation date:** `1819`, `1. Juli 1960` and `14. Jan. 1861` all work.
- **Fencing principle:** `pflichtschlagend` is 4, `pflichtfechtend` is 3, `fakultativ schlagend` or `freischlagend` is 2 and
  `nichtschlagend` is 1. Anything else is left unknown, with a warning.
- **Colours:** German colour words become the colours of the builder's palette, for example `hellblau-weiß-gold` becomes
  `blue_light-white-gold`. Shades the palette lacks are replaced by the closest colour (`blassrot` becomes `red`, `kohle`
  becomes `black`), with a warning. If a word can't be read at all, the colours of that corporation are left empty instead
  of guessed, and the word is listed in the report. `(v.u.)` means "from the bottom up", so the stripes are reversed.
  `auf weißem Grund` gives the base colour of the sash (`blue-white-orange@white`), and `mit silberner Perkussion` or
  `Perkussion silber` the percussion (`+silver`). Adjective endings such as `weißem` or `goldener` are understood. Other
  remarks in brackets are ignored and counted in the report.
- **Colours principle:** `(f.f.)` stands for "farbenführend", which the lists explain as having colours without wearing them.
  Those corporations get the principle 3, "not wearing colours". The lists call all others "farbentragend", so corporations
  with colours and without that remark get 5, "wearing is mandatory". That is the lists' own wording, but they don't say
  whether wearing is really mandatory, so clear the column if you don't want that claim. Corporations without colours
  stay unknown.
- **Associations** become the `organisations` column. Where the abbreviation links to an article, the title of the article
  is used as the name of the organisation. The pin colour of organisations is left empty, which makes their pins grey.
- **Coordinates:** only the main coordinates of an article are used. They may mark the house of the corporation, but they
  may also mark something else, such as the town, so look at the pins on the map.
- Street, postal code and everything about contacts stay empty. Wikipedia's lists don't have them.

## Being a good guest

The tool uses Wikipedia's API instead of loading pages, identifies itself with your address, asks for one thing at a
time with a short pause, waits as long as Wikipedia asks when it says to slow down, and keeps answers so that nothing is
asked twice. Please don't remove these limits and don't run it in a loop.

## License

The content of Wikipedia is available under the
[Creative Commons Attribution-ShareAlike license (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/). If
you publish a database that you made with this tool, credit Wikipedia and check what the license means for what you
publish. I'm not a lawyer, so this is a pointer, not advice.

## Tests

`yarn test __tests__/tools` runs the tests of both tools. The importer is tested against pages in the shape of Wikipedia's
lists and a stand-in for the API, including the whole way to a database that the app accepts.
