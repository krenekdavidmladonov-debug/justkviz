# JustKvíz: tmavý vzhled existující aplikace

Výchozí sestava je nasazený rebranding `40c124ec38cc709e65bfb33c80de371a01eaba3a`, nikoli neúplný `main`. Samostatná větev `codex/justkviz-dark-mode` navazuje na `codex/justkviz-rebrand`. PR #28/#29 se nemění.

## Implementace

`apps/web/src/styles/theme.css` obsahuje původní společné tokeny doplněné o navy vrstvy, modré akce/výběr, žlutou značku, focus a stavové barvy. Je připojený jako blokující stylesheet v počátečním HTML spolu s `color-scheme: dark` a `theme-color`. Tmavý základ funguje i před spuštěním JavaScriptu, přihlášením, při přímém odkazu a světlém nastavení OS. Nevzniká přepínač, ukládání preference ani druhý theme systém.

Stávající globální/editorové styly a konfliktní stav bodování používají tyto tokeny. Pokryté jsou nativní input/select/option, checkbox/radio/range, souborové pole, autofill, scrollbary, HTML dialogy v horní vrstvě a nabídky. `forced-colors` zůstává řízené prohlížečem. Modrá akční výplň má samostatnou kontrastní hranici; jemné dekorativní linky se nepoužívají jako jediná identifikace polí.

Společný typografický nápis má v ovládání světlé „Just“ a žluté „Kvíz“. Finální logo nevzniká, dočasná JK favicon a absence autora v hlavním logu zůstávají zachované.

## Hranice obsahu

Blok CSS obsahového rendereru, jeho model, média, geometrie, uložená pozadí, overlay, odpovědi a snapshoty se nemění. Obsahové canvas používají vlastní barvy a značkové proměnné; nezdědí nové UI barvy. Historická barva značky uvnitř uloženého vzhledu slidu zůstává stejná. QR má stále černou/bílou. Není přidaný `invert`, `brightness` ani filtr na stránce.

Pixelová regrese používá přes normální UI uložené bílé pozadí a porovnává obsah při původních a nových UI tokenech. Vyjmuté jsou pouze čtyři zaoblené rohy rámu, kterými prosvítá záměrně změněné okolí. Referenční hash samotného obsahového CSS chrání existující vzhled. Tiskové ovládání je tmavé; iframe s PDF používá světlé schéma a původní PDF generátor zůstává beze změny.

## Rozsah obrazovek a stavů

| Existující plocha | Upraveno | Ověření / hranice |
|---|---|---|
| Přihlášení, přístup zamítnut, odhlášení, 404, načítání | Sdílený HTML základ a formuláře | Fresh browser, světlý OS, reload, přímé odkazy; samostatná stránka obnovy hesla v aplikaci není |
| Administrace, desktop/mobil menu, knihovna, detail/vytvoření kvízu | Panely, tabulky, prázdné stavy, navigace, tlačítka | Skutečné stránky, původní responzivní rozložení |
| Editor kol a pěti typů otázek | Osnova, aktivní výběr, ABCD radio, koncepty, validace, disabled/focus | Původní kompletní autorský E2E; vlastní vizuální/klávesnicová regrese |
| Média, URL picker, knihovna médií, upload/progress/cancel/error | Sdílená pole a ovládání | Uploadový stav je uvnitř pickeru; systémový file chooser není vlastní dialog aplikace |
| Náhled, soukromá zkouška, moderátor | Okolní UI a ovládání | Obsahový renderer zachovaný, skutečné přehrávání v regresích |
| Projektor | Čekací/chybová plocha, fullscreen ovládání, okolí canvas | Samostatný anonymní kontext; skutečný slide je obsahová výjimka |
| Akce, týmy, registrace, bodování, rozhodčí, výsledky | Sdílené formuláře, datum/čas, dialogy, tabulky, konflikt | Dostupné vlastní plochy; výsledkový canvas má vlastní obsahové barvy |
| Tisk | Výběr dokumentu, nastavení, prázdný stav | Samotné PDF zůstává světlé; žádné Functions se nenasazují |
| Nápovědy, upozornění, chyby, nabídky | Existující textové a stavové prvky | Žádná nová stránka nastavení nebo nápovědy; vypnuté týmové e-maily se nezapínají |

Přesný stav LOCAL / CI / ONLINE a konkrétní screenshoty jsou v závěrečném reportu tohoto běhu, neodvozují se pouze z této tabulky implementace.

## Ověření a nasazení

Nové testy jsou v `tests/darkTheme.test.ts` a `tests/browser/dark-theme.*`. Měří běžný text/placeholdery minimálně 4,5:1 a hranice/focus minimálně 3:1; browser audit měří skutečné computed barvy, není prohlášením o úplné shodě WCAG. Podklad: [W3C kontrast textu](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) a [W3C netextový kontrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Původní kompletní autorský test, Rules, soukromé kontrakty a výkonové scénáře zůstávají zapnuté. CI zahrnuje novou regresi a skutečnou základní větev. Online QA vytváří pouze označená vlastní data přes UI; před/po se porovnávají read-only otisky původních dokumentů a uklízejí pouze vlastní cesty a generace médií.

Povolené nasazení je pouze Hosting site `filmovy-kviz-v2-staging` po review a celém CI pro čisté SHA. Předchozí release se zaznamenává a kontroluje znovu těsně před deployem. Žádné změny/deployment Functions, Rules, indexů, IAM, API, secrets, bucketu ani datového schématu. Build používá stejné projektové ID/AppId/bucket/domény a vypnuté týmové e-maily. Obnova případné vážné regrese se týká pouze předchozího kompatibilního Hostingu.

Externí iframe, prohlížečový PDF viewer, systémové dialogy, browser chrome a Firebase Console nemají aplikací ovládaný vnitřní motiv. Záměrně světlý uživatelský obsah, QR a tiskové stránky jsou zachované výjimky.
