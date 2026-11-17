# JustKvíz SHOW MODE — návrh ke schválení

Následný stav: vlastník schválil všechny tři obrazovky a plnou lokální implementaci.
Dokončení a nové důkazy vede [SHOW_MODE_RELEASE.md](SHOW_MODE_RELEASE.md). Níže je
zachovaný záznam první návrhové fáze; její tehdejší čekání na souhlas již neplatí.

Datum: 15. 10. 2026. Fáze 1: skutečný lokální React prototyp, technický kontrakt a QA návrh. Plná implementace do živé aplikace čeká na vlastníkem požadované schválení vizuálního směru.

## Ověřený základ

Při zahájení byl checkout čistý, větev `codex/whole-evening-slide-design`, HEAD `be81596`. Vzdálený `main` byl ověřen přes `git ls-remote` jako `524cf56`; společný předek je `fe9ff05`. Vzdálená historie navíc obsahuje dva merge commity, ale diff zdrojů `fe9ff05..524cf56` je prázdný. Lokální `be81596` navíc obsahuje následné celé vizuální autorství a jeho ověření. Návrh proto vychází z `be81596`, nikoli ze staršího stagingového webu.

Práce je izolovaná na `codex/show-mode-design-review`. Tři pracovníci mají oddělené soubory ve společné pracovní větvi; integraci a commit provádí pouze lead. Existující worktrees zůstávají nedotčené.

## Jak otevřít návrhy

Z kořene repozitáře spusťte `node tools/show-mode/preview.mjs` a otevřete `http://127.0.0.1:5216/show-mode-preview.html`.

Samostatný HTML vstup používá současný renderer a značku se syntetickými daty. Není importován produkčním routerem ani hlavním HTML vstupem. Launcher vynucuje lokální `demo-*` konfiguraci. Ovládání prototypu mění pouze místní návrhový stav; nepublikuje výsledky a nemá připojené show audio.

Tři obrazovky: průběžný overlay nad projekcí, ručně odhalené finálové umístění a vítězný okamžik. Návrh přebírá tmavě modrou `#0B1220`, plochy `#111C2E`, žlutý akcent `#FFC107`, komponentu `Brand` a současný fontový stack. Nenahrává se nový font ani grafická knihovna. Stávající dědičnost vzhledu musí zůstat součástí následné integrace.

## Režie a implementační návaznost

Průběžný panel používá krátký nástup nad ztmaveným slidem, čitelné stránkované řádky a doložené změny pořadí. Finále odhaluje celé skupiny shodného umístění odspodu; TOP 3 a vítězové čekají na samostatný ruční krok. Vítěz má typografický nástup a poté stabilní slavnostní obraz. Přeskočení i režim bez efektů zůstávají okamžitě dostupné.

Produkční integrace rozšíří stávající potvrzené verze a serverové příkazy. Žádný druhý výpočet skóre ani klientský zdroj pořadí nevznikne. Dosud neodhalené týmy nesmějí být v public payloadu. Overlay vyžaduje explicitní sanitizovaný podklad a serverem zachycený návratový stav; média se po návratu sama nespustí. Show audio bude řízené z moderátorského zařízení, s ručním odemknutím, testem zvuku a společným STOP/interlockem vůči otázkám. Podrobnosti a testovatelné výjimky jsou v kontraktu.

## Rozdělení práce

| Agent | Odpovědnost | Výstup |
| --- | --- | --- |
| 0 — lead | základ, společné hranice, lokální server, vizuální kontrola, integrace | tento dokument, capture/performance evidence |
| 1 — GPT-6.1 Sol HIGH | vizuální identita a pohyb | `apps/web/src/show-mode-preview/`, [vizuální specifikace](SHOW_MODE_VISUAL.md) |
| 2 — GPT-6.1 Sol HIGH | engine, moderátor, audio, bezpečný návrat | [technický kontrakt](SHOW_MODE_CONTRACT.md) |
| 3 — GPT-6.1 Sol MEDIUM | soukromí, remízy, regrese, výkon | [QA matice](SHOW_MODE_QA.md) |

Všichni čtyři dokončili první fázi. Lead i nezávislý QA pracovník prohlédli všech šest hlavních screenshotů a nenašli blokující vizuální závadu.

## Skutečně provedené ověření

- Web TypeScript, cílený ESLint a produkční Vite build: PASS. Prototyp ani jeho text/CSS nejsou v produkčním `dist`; existující varování o přibližně 983 kB hlavním JS chunku zůstává. Úplný `pnpm check` ani Rules suite nebyly v této návrhové fázi opakovány, protože žádný produktový nebo bezpečnostní soubor není změněn.
- Současný základ: 133 PASS v 11 cílených unit sadách na Node 22.23.2; přesný rozsah a předchozí sandboxové potíže jsou v QA dokumentu. Tento výsledek nedokládá budoucí serverové rozšíření.
- Prototyp: osm skutečných browser scénářů PASS — stránky, stejná otázka po návratu, absence budoucích leaderů v DOM finále, remíza, společné vítězství, celé odhalení 11 → 1, skip/statický režim a systémový reduced motion. Audio je nepřipojené a žádný přehrávač není namontován.
- Šest hlavních screenshotů má přesně 1920×1080 / 1280×720, bez zjištěného geometrického přetečení, browser chyby nebo nelokálního požadavku. První pokus o capture nebyl schopen připojit se k sandboxovému serveru; opakovaný loopback browser/server mimo tuto izolaci prošel. Nešlo o chybu renderingu.
- Důkazy: `.local-data/show-mode-review/capture.json`, `verification.json`, `{interim,finale,winner}-{1920,1280}.png`, `shared-winners.png`, `moderator-prototype.png`. Reprodukce přes `tools/show-mode/capture.mjs` a `verify.mjs`, s běžícím lokálním preview.

## Předběžné měření návrhu proti stávajícímu zobrazení

Chromium 151.0.7922.34, headless, Windows 10.0.26200, Ryzen 9 8940HX, 32 logických CPU, 1920×1080 / DPR 1, Node 22.23.2. Střídavé běhy v jednom browser contextu, zahřátý Vite dev server a cache, stejných šest syntetických týmů. Baseline je skutečný nezměněný `ResultsTable`; návrh je nový overlay nad skutečným slidem. Měřeno 30 načtení každé varianty; doplňkově šest s CDP CPU ×4. Jde o místní render, ne latenci moderátor → Firestore → projektor.

| Metrika | Stávající tabulka | Návrh overlaye |
| --- | ---: | ---: |
| DOM canvas od začátku navigace, medián | 93,4 ms | 94,4 ms |
| Stejná metrika, p95 | 103,3 ms | 111,6 ms |
| Nejdelší RAF interval v 750 ms po mountu | 12,1 ms | 12,0 ms |
| DOM canvas, medián při CPU ×4 | 180,6 ms | 184,1 ms |
| Nejdelší RAF interval při CPU ×4 | 12,1 ms | 18,2 ms |
| Počet DOM potomků canvasu | 46 | 87 |

V těchto vzorcích nebyl po mountu zaznamenán RAF interval nad 25 ms ani long task nad 50 ms. Návrh má více DOM uzlů a mírně horší medián připravení i nejdelší interval při CPU ×4; není prokázáno zrychlení. DOM připravení není okamžik skutečného paintu. Headless RAF (zde přibližně 6,1 ms) není měření GPU FPS ani obnovování fyzického projektoru. Host byl sdílený s vývojovými kontrolami, není to izolovaný benchmark; malé rozdíly nejsou výkonová garance. Produkční build, finále/vítěz a kompletní serverová latence vyžadují po implementaci vlastní srovnání podle QA protokolu.

## Hranice předání

Toto předání není dokončený SHOW MODE ani vydání pro staging. Reálná síťová synchronizace, audio soubory, jejich bezpečné oprávnění a per-event ukládání se implementují po schválení směru. Prototyp ani prohlížečová měření nenahrazují zkoušku na projektoru a zvukové technice. Žádný deploy, změna cloudových dat ani přístup k V1/produkci nejsou součástí této fáze.
