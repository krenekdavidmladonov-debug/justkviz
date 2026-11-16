# JustKvíz — etapa 1A: úklid úvodního rozhraní

Stav etapy 1A k 16. 9. 2026: **LOKÁLNĚ IMPLEMENTOVÁNO A OVĚŘENO. NENASAZENO.** Následné review etapy 1B a cílená oprava CI v etapě 1C jsou zaznamenány na konci tohoto reportu.

## Výchozí stav

- Výchozí SHA: `456f3eb62d5c52841afc3f055159711f279d11d3`.
- Pracovní větev: `codex/justkviz-ui-cleanup-01`.
- Worktree: `C:\Projects\filmovy-kviz-worktrees\justkviz-ui-cleanup-01`.
- Základ určen z místního dokončeného release reportu PR #32: `C:\Projects\filmovy-kviz-v2\.local-data\justkviz-event-management\.local-data\event-management\REPORT.md`. Report eviduje dokončené nasazení tohoto SHA a závěrečnou kontrolu 16. 9. 2026 ve 14:20 UTC. Současný cloudový stav nebyl znovu čten.
- Nebyl použit starší hlavní worktree ani automaticky `main`. Historický rebrand `40c124e` je předkem vybraného základu. Novější základ zahrnuje tmavý vzhled, osobní přístupy a správu akcí.
- Před implementací bylo všech 34 existujících worktrees bez sledovaných i nesledovaných rozpracovaných změn. Závěrečná kontrola potvrzuje změny pouze v novém worktree. Ignorované místní release podklady zůstaly zachovány. Úplný seznam cest, větví, HEAD a stavů: [worktree-inventory.json](../.local-data/ui-cleanup/worktree-inventory.json).

| Relevantní worktree / větev | HEAD | Stav při zahájení |
| --- | --- | --- |
| Hlavní / `chore/v2-staging-environment` | `81a24c85b0fc187876a6421c29c15b7d0101a5b3` | Čistý, starší základ |
| `codex/justkviz-rebrand` | `40c124ec38cc709e65bfb33c80de371a01eaba3a` | Čistý |
| `codex/justkviz-dark-mode` | `17526c0fa5c9fdaabeb167a546282f78fb0208e4` | Čistý |
| `codex/owner-takeover` | `be094fd17e18276130678952cf69417ce917245e` | Čistý |
| `codex/justkviz-event-management` | `456f3eb62d5c52841afc3f055159711f279d11d3` | Čistý, poslední místně doložený dokončený release |

## Co se mění pro uživatele

- U značky je na desktopu i mobilu decentní štítek **Testovací verze**. Stejně jako dosud se řídí výhradně `VITE_APP_ENV === 'staging'`.
- Omezení testovacího provozu zůstává přímo viditelné: **Pro zkoušení používejte pouze smyšlená data.** Věta stanoví pravidlo pro zkoušení; netvrdí, že veškerý již uložený obsah je smyšlený. Nic není schováno do tooltipu a žádná data se neupravovala.
- Menší nadpis **Přehled**, méně prázdného místa, sjednocený pás akcí **Nový kvíz / Vytvořit akci / Kvízy / Akce**. Odkazy používají existující cesty a kontroly `can('quiz.create')`, `can('event.create')`, `can('quiz.read')`, `can('event.read')`.
- Vytváření vede na původní formuláře `/admin/quizzes/new` a `/admin/events/new`. Router, formuláře, ověřování členství a serverová oprávnění se nemění. `AuthProvider` nadále odvozuje `can` z aktivního členství; server kontroluje oprávnění a rozsah samostatně.
- **Pokračovat** stále vybírá první koncept ze seznamu seřazeného podle úpravy, jinak první kvíz. Nezaměňuje poslední úpravu za poslední otevření. Zůstává skutečný popis, pokud existuje, a datum úpravy. Obecná věta o připravenosti je odstraněna, počty se nepřidávají.
- Prázdný seznam doporučuje vytvoření kvízu, nebo požádání správce o přístup podle oprávnění. Načítání, chyba a opakování načtení zůstávají funkční.
- Mobilní tlačítka mají dva sloupce, karty se řadí pod sebe a dlouhé názvy se zalamují. Hlavička se již neroztahuje do výšky u krátkého nebo prázdného obsahu.

## Upravené soubory

1. `apps/web/src/app/AdminShell.tsx` — štítek a srozumitelné upozornění.
2. `apps/web/src/routes/admin/AdminPage.tsx` — kompaktní přehled, existující akce a prázdný stav.
3. `apps/web/src/styles/global.css` — styly přehledu, štítku a mobilní výška hlavičky.
4. `tests/adminDashboard.test.tsx` — 14 cílených kontrol UI a počtu čtení.
5. `vitest.config.ts` — zapojení testu do stávající sady.
6. `docs/UI_CLEANUP_01.md` — tento report.

Lokální screenshoty, náhledový server, browser kontrolní skript a logy jsou ignorované pod `.local-data/ui-cleanup/`. `.env.local` je pouze kopie `.env.example` s `demo-filmovy-kviz-v2` a emulátory, mimo Git. Závislosti byly připraveny ze zamčené místní cache přes `pnpm install --offline --frozen-lockfile --ignore-scripts`; lockfile a knihovny se nemění.

## Výsledky kontrol

Před spuštěním byly přečteny package scripts, Vite/Vitest konfigurace a Git hooky. Spuštěné příkazy neobsahují deploy, migraci ani cloudový inventář. Build pouze kompiluje zdroje; nespouští Functions.

| Kontrola | Výsledek a důkaz |
| --- | --- |
| `pnpm check` — typecheck, lint, build | **PASS**, včetně opakování po opravě mobilní hlavičky; [check.log](../.local-data/ui-cleanup/check.log) |
| `pnpm test:unit` | **PASS**, 41 souborů / 377 testů, z toho 14 kontrol přehledu; [unit.log](../.local-data/ui-cleanup/unit.log) |
| Štítek podle konfigurace | **PASS**, staging zobrazuje štítek i viditelné omezení; production/development/nezadaná hodnota je nezobrazují. Jde o test UI, nikoli připojení k produkci. |
| Čtyři hlavní odkazy | **PASS**, skutečný router otevřel existující seznamy a formuláře. |
| Uživatel bez práva vytvářet | **PASS**, odkazy chybí, přímé cesty odmítá původní PermissionGate, Pokračovat vede do detailu. Testovány také oddělené sady oprávnění pro kvízy a akce. |
| Načítání, chyba, opakování, prázdný seznam | **PASS**, oba prázdné stavy dle oprávnění, chyba nezobrazuje prázdný seznam, retry obnoví obsah. |
| Desktop/mobil a dlouhé názvy | **PASS**, Chromium 1440/1100/1024/768/390/320 px, bez vodorovného přetečení, tlačítka nejméně 44 px, mobilní hlavička se nenatahuje. Snímky vizuálně zkontrolovány. |
| Klávesnice a čitelnost | **PASS**, Tab prochází akce v pořadí, viditelný 3px focus, Enter otevře sekci. Nejnižší naměřený kontrast kontrolovaných textů 6,40 : 1; nejde o úplný audit přístupnosti. |
| Žádná nová čtení | **PASS**, před i po `[quizzes, quizzes]` v development StrictMode; při renderu bez StrictMode unit test potvrzuje jedno čtení. U profilu bez `quiz.read` nula. Repository, effects a datová vrstva beze změny. |
| Externí požadavky browser QA | **PASS**, povolen pouze `127.0.0.1`, externí pokusy 0, chyby browseru 0. |
| Rozsah diffu a zachování původních worktrees | **PASS**, `git diff --check`; beze změn Functions, Auth, Rules, indexů, Storage, konfigurace nasazení, závislostí a datových dotazů. |
| Skutečné přihlášení, serverové vytváření a Security Rules v emulátoru | **NEOVĚŘENO** v tomto kroku: browser používá náhradu Auth a datového rozhraní s lokálními fixtures. Nebyla spuštěna emulator E2E ani `pnpm test:rules`; autorizační implementace se nemění. |
| Nasazená aplikace a cloudová data | **NEOVĚŘENO**, záměrně bez cloudového přístupu. |

Browser ověření etapy 1A spouští skutečnou aplikaci a původní router, nahrazuje AuthProvider a modul access/api. Data pocházejí z deklarovaných fixtures v `functions/src/dev/seed-quizzes.ts`; seed skript se nespouští. Náhled blokoval accessCall a externí hosty; přímé create callable tehdy samostatně blokovány nebyly. Formuláře se pouze otevíraly, neodesílaly. Původní širší tvrzení o zákazu všech zápisů bylo při review opraveno; žádný skutečný zápis nebyl zjištěn. [Browser výsledky](../.local-data/ui-cleanup/browser-results.json), [srovnání čtení před úpravou](../.local-data/ui-cleanup/before-results.json).

Při přípravě QA byly opraveny lokální ESM cesta na Windows a tvar fixture odpovědi stránkovaného seznamu akcí. Následný kompletní browser běh je PASS. Při vizuální kontrole nalezené natažení mobilní hlavičky je opraveno a znovu ověřeno. Build hlásí stávající upozornění na velikost JS balíčku a lokální Node 24 oproti deklarovanému Functions Node 22; backendový runtime zde nebyl spouštěn.

## Screenshoty před a po

Všechny snímky vznikly lokálně se stejnými testovacími podklady, nikoli z cloudových dat.

| Velikost | Před | Po |
| --- | --- | --- |
| Desktop 1440 × 900 | [before-desktop.png](../.local-data/ui-cleanup/before-desktop.png) | [after-desktop.png](../.local-data/ui-cleanup/after-desktop.png) |
| Mobil 390 px | [before-mobile.png](../.local-data/ui-cleanup/before-mobile.png) | [after-mobile-390.png](../.local-data/ui-cleanup/after-mobile-390.png) |

Další důkazy: `after-mobile-320.png`, `after-long-title-320.png`, `after-empty-owner.png`, `after-empty-viewer.png`, `after-loading.png`, `after-error.png`, `after-keyboard-focus.png` ve stejném adresáři.

## Další krok a hranice práce

Obě možnosti vytvoření jsou připravené a využité, žádné nefunkční tlačítko nebylo přidáno. Bez dalšího dotazu nelze spolehlivě určit poslední otevření ani nejbližší akci; nic takového se nedoplňuje. Existující názvy včetně „Normalizované“ zůstávají beze změny.

Předchozí release report popisuje samostatný problém uploadu médií v rozsahu „vlastní kvízy“. Zůstává mimo tuto úpravu; Storage ani editor nebyly měněny. Historické provozní dokumenty nebyly globálně přepisovány.

Doporučený nejbližší malý krok: zkontrolovat tyto screenshoty a lokální diff jako celek; případné nasazení řešit samostatně s novým ověřením tehdejšího výchozího stavu a výslovným souhlasem.

**V etapě 1A:** Push: ne. PR vytvořen nebo přepsán: ne. Merge: ne. Deploy: ne. Cloudové operace / Firebase přístup: ne. V1 nebyla kontaktována ani pro čtení.

## Etapa 1B — nezávislé review a příprava Draft PR

Ověřený commit úklidu: `0d340d2f8e0a47dd4a3d6db701bfdce54354d99d`, potomek výše uvedeného základu. Worktree byl na začátku čistý a skutečný diff obsahoval právě šest uvedených souborů. Etapa 1B nepřidává změnu produkčního kódu; nový commit pouze zpřesňuje tento report. Původní commit se nepřepisuje.

Samostatný read-only review agent zkontroloval přesný diff, router, oprávnění, CSS selektory, konfiguraci testů a místní screenshoty. **Bez blokujícího nálezu a bez zjištěné regrese produkčního UI.** Review není finální schválení PR.

| Nález | Stav |
| --- | --- |
| P3: historické tvrzení o zákazu všech zápisů v náhledu nebylo plně doloženo | **Opraveno** — historický popis výše zpřesněn. Nový lokální náhled odmítá inicializaci Firebase services, eviduje případné pokusy a browser povoluje pouze přesný origin `http://127.0.0.1:5208`, nikoli ostatní localhost porty. |
| CI nemá správnou PR base v seznamu spouštěcích větví | **Blokující pro označení CI jako PASS**, nikoli pro vznik Draft PR. Workflow nebylo měněno a jiná base se nepoužívá k vynucení zelené kontroly. |
| Dříve dokumentovaný upload médií ve scope „vlastní kvízy“ | **Neblokující pro tento UI diff, odloženo** — nebyl znovu ověřován ani opravován. |

### Rozsah sdílených stylů a běhové ověření

Dashboard selektory používá pouze AdminPage. Brand, upozornění a mobilní `grid-template-rows: auto 1fr` záměrně platí pro celý AdminShell. Editor a live control mají vlastní router větve mimo tento shell; mimo něj jsou také projektor, veřejné registrace a rozhodčí. Nové selektory na tyto obrazovky nedopadají.

Nový lokální browser běh: **PASS**. Přehled ověřen na 1440, 1280, 1100, 1024, 768, 390 a 320 px; šest dalších sdílených povrchů na 1440/1280/390/320 px: knihovna kvízů, nový kvíz, seznam akcí, nová akce, editovatelný detail akce a uživatelé/přístupy. Bez vodorovného přetečení stránky, chyb browseru a pokusů o spojení mimo náhled. Tab/Enter, viditelný focus, textový kontrast nejméně 6,40 : 1, načítání, chyba s retry a oba prázdné stavy prošly. Snímky byly vizuálně zkontrolovány.

Oba create formuláře byly otevřeny z přehledu, vyplněny bez odeslání, opuštěny pomocí Zpět v prohlížeči a původního zpětného odkazu. Při opětovném otevření jsou pole prázdná; nebyl zaznamenán žádný pokus o backendové volání. Existující idempotency ID kvízu v sessionStorage není databázový záznam. Původní formuláře, PermissionGate, can a feature flags se nemění. UI test není důkazem serverové autorizace.

Kvízové fixtures vycházejí z původního lokálního seedu, data detailu akce z existujícího `events-form-ux.mocks.ts`. Read-only seznamy přístupů mají prázdné lokální odpovědi. Všechny tyto náhrady zůstávají pouze v ignorovaném náhledovém skriptu. Běžný build ani aplikace je neimportují.

### Test discovery a kontroly

`vitest.config.ts` má explicitní seznam testů, proto bylo nutné přidat nový soubor. Porovnání přes `vitest list --json` s původní konfigurací z výchozího commitu: **40 souborů / 363 případů před**, **41 souborů / 377 případů po**, **0 odebraných**, **14 přidaných**. Žádné nové skip/only, potlačení chyb nebo oslabení původních kontrol.

- **PASS:** opakované `pnpm check` (typecheck, lint, build).
- **PASS:** opakované `pnpm test:unit`, 41 souborů / 377 testů.
- **PASS:** výše popsaný rozšířený lokální browser běh a porovnání počtu čtení; přehled má stále dvě volání v development StrictMode, bez quiz.read nulu.
- **NEOVĚŘENO:** skutečné přihlášení, serverové mutace a Rules v emulátoru. V tomto kroku nebyly spuštěny, serverová implementace je beze změny.
- **NEOVĚŘENO běhově v etapě 1B:** plný editor a náhled slidů, živý projektor, veřejné registrace a obrazovka rozhodčího. Jsou mimo dotčený AdminShell a nový fixture náhled neposkytuje jejich živé datové kontrakty. Izolace CSS byla ověřena staticky; úspěšný build není vydáván za jejich vizuální test.
- **NEOVĚŘENO:** cloudová aplikace a data — bez přístupu.

Místní důkazy jsou pod `.local-data/ui-cleanup/review-1b/`: `check.log`, `unit.log`, `tests-before.json`, `tests-after.json`, `browser-results.json`, `after-desktop.png`, `after-width-1280.png`, `after-width-390.png`, `after-width-320.png` a snímky sdílených stránek. Tyto soubory nejsou veřejně hostované ani součástí PR.

### PR base, workflow a CI

Remote ověřen jako zadaný soukromý GitHub repozitář. Vzdálená `codex/justkviz-event-management` je stále přesně `456f3eb62d5c52841afc3f055159711f279d11d3`; navržený PR diff je proto totožný s diffem úklidu proti předanému základu. `main` by navíc přibalil 26 nesouvisejících commitů a není vhodnou base. Před publikací nebylo pro pracovní větev žádné existující PR.

Přečteny workflow na pracovní, cílové i výchozí větvi, relevantní package skripty, lokální emulator guard a Git hooky; vzdálené workflow na cílové větvi mají stejná Git blob SHA jako lokální soubory. Bez reusable workflow, workflow_run/pull_request_target, deploy kroku, cloudových credentials, secrets nebo id-token oprávnění; deklarované Firebase testy používají pouze localhost emulátory a demo projekty. Žádný aktivní lokální Git hook ani repository webhook nebyl nalezen.

**CI: NEOVĚŘENO — pro tento PR se automaticky nespouští.** Hlavní workflow reaguje na push jen do main a na PR do vyjmenovaných větví, mezi kterými `codex/justkviz-event-management` chybí. Operátorské workflow nesplňuje path filtr tohoto diffu. Žádné z nich nemá workflow_dispatch. Starší zelené běhy nejsou výsledkem tohoto HEAD. Konečné SHA, odkaz na Draft PR a přesný stav vzdálených kontrol patří do popisu PR a závěrečného předání.

Závěr: **připraveno pouze k dalšímu review**. Před samostatným rozhodnutím o staging nasazení chybí dostupné CI pro správnou base a přesný commit. Workflow ani cílová větev nebyly upraveny za účelem obejití této mezery. Etapa 1B povoluje pouze standardní push pracovní větve a Draft PR; merge, deploy, Firebase operace a kontakt s V1 nejsou součástí tohoto kroku.

## Etapa 1C — cílené spuštění stávajícího CI

Výchozí stav znovu ověřen: lokální i vzdálený HEAD `05b8d2a0901cabad06ce8494041ddaa47aee1854`, čistý worktree, Draft PR [#33](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/pull/33) s base `codex/justkviz-event-management` na `456f3eb62d5c52841afc3f055159711f279d11d3`. Ancestry souhlasí; base ani předchozí commity se nemění.

Na výslovné zadání etapy 1C se do existujícího `.github/workflows/ci.yml`, `on.pull_request.branches`, přidává jediná přesná větev `codex/justkviz-event-management`. Všechny původní větve zůstávají. Žádné rozšíření wildcardem, nový trigger, změna oprávnění, verzí, příkazů, test discovery nebo checkout strategie. Výchozí `pull_request` události již zahrnují `synchronize`, proto běžný push do head větve stačí; nejsou přítomné path/types filtry ani podmínky vynechávající Draft PR. Viz [GitHub dokumentace pull_request](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

YAML obou workflow byl úspěšně parsován. Po odebrání právě jedné přidané položky je načtená struktura hlavního workflow přesně shodná s původní: job `quality-gate` / „Quality gate“, všech 25 kroků, `contents: read`, push pouze do `main`, runtime verze i bezpečnostní guardy. Druhé workflow `owner-takeover.yml` zůstává beze změny; jeho paths zahrnují pouze konkrétní vlastní workflow a operátorské soubory, nikoli `ci.yml` ani ostatní soubory PR. Žádný navazující `workflow_run`, reusable workflow, deploy krok, cloudové credentials či aktivní Git/repository hook nebyl nalezen.

Stávající Firebase testy používají pouze lokální emulátory a `demo-*` projekty. Syntetické regresní testy v adresáři `migration-v1` pracují s lokálními fixtures a emulátorem přes localhost/demo guard; nečtou V1 a nespouštějí cloudovou migraci. Stažení závislostí a emulátorových binárek je součástí povoleného CI.

Cílené nezávislé read-only review samostatným agentem: **bez nálezů**. Reviewer ověřil YAML, přesný strukturální diff, ostatní triggery, lokální guardy i nezměněný aplikační a testovací kód; aktuální GitHub base ověřil hlavní agent. Review není náhradou výsledku skutečného CI ani finálním schválením PR.

Proti výchozímu HEAD etapy 1C se mění pouze jeden řádek workflow a tento report. Aplikační kód, CSS, testy, závislosti, lockfile i ostatní konfigurace zůstávají shodné. Dosavadní PR diff se rozšiřuje ze šesti na sedm souborů. Lokální UI/build/unit výsledky etapy 1B se nevydávají za nové vzdálené CI.

**Výsledek běhu se při tomto commitu nepředjímá.** Konečné HEAD, run URL/ID, událost, výsledky jednotlivých kroků a skutečný checkout SHA budou doplněny do popisu Draft PR a závěrečného předání, bez následného dokumentačního commitu. Případný dočasný merge checkout musí mít jako rodiče ověřenou base a přesný aktuální HEAD. Předchozí neověřené oblasti zůstávají platné, dokud konkrétní dokončený test nedoloží opak; cloudová aplikace a skutečná cloudová data jsou nadále mimo rozsah.

Tato změna opravuje spouštění kontrol; nepovoluje merge ani nasazení. PR zůstává Draft, bez auto-merge, bez změny base, bez přístupu k Firebase cloudu a bez kontaktu s V1.

## Etapa 1D — aktualizace zastaralých E2E očekávání

Před změnou znovu ověřen čistý worktree, lokální i vzdálený HEAD `4db0d9f74bcfaaedb4ae272123dfd20dda17c255` a nezměněná base `456f3eb62d5c52841afc3f055159711f279d11d3` na `codex/justkviz-event-management`. PR #33 zůstává Draft. Historický [CI běh 35148215586](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/runs/35148215586) skutečně selhal na dvou odkazech „Otevřít knihovnu“ v complete-editor; testoval dočasný merge checkout `819114078e8f2190b5a7cf63aafd90de4b52b465`, nikoli jinou pracovní větev.

| Soubor a scénář | Oprava a zachovaný účel |
| --- | --- |
| `tests/browser/complete-editor.spec.mjs`: entire quiz from empty library… | Globální link „Otevřít knihovnu“ nahrazen přesným linkem „Kvízy“ uvnitř přesně pojmenované navigace „Akce přehledu“. Test stále začíná přihlášením a přehledem, kliká v hlavním přehledu a pokračuje knihovnou. |
| Tentýž soubor: minimal quiz authored through UI… | Stejná oprava; následné vytvoření, persistence, rehearsal a porovnání s live streamem zůstávají nedotčené. |
| `tests/browser/events-form-ux.spec.ts`: both forms visual contract, 1280/1024/390 px | Původní text „STAGING — pouze syntetická testovací data“ nahrazen přesným viditelným „Testovací verze“ a přesným viditelným upozorněním „Pro zkoušení používejte pouze smyšlená data.“ v `main` / `note`. Stále se ověřuje označení prostředí i omezení dat; rozměry a screenshotová očekávání zůstávají stejné. |

Oba navigační testy navíc ověřují právě jeden nalezený odkaz, `href=/admin/quizzes` a URL po skutečném kliknutí. Sidebar má jinou sémantickou navigaci „Administrace“, a proto nemůže být zvolen omylem. Nevznikly žádné nové first/last/nth, force click, náhradní goto, mocky ani pomocná vrstva. Všechny původní funkční assertions a kroky jsou zachovány. Cílený scan browser testů a souvisejících helperů již nenašel další očekávání odstraněných UI textů; konfigurace stagingových QA nástrojů nejsou zastaralé popisky a nebyly dotčeny.

Cílené nezávislé read-only review obou testových diffů: **bez nálezů**. Původně nalezené další textové očekávání ve formulářových testech bylo opraveno v povoleném rozsahu. Samostatná předexistující nekompatibilita jeho fixture harnessu zůstává níže výslovně oddělena.

### Lokální výsledky před commitem

- **PASS:** oba původní complete-editor scénáře v plném rozsahu, 2/2 za přibližně 1,5 minuty, Node 22.23.2, Java 21, původní produkční Vite build a původní Playwright konfigurace. Spuštění přes `firebase emulators:exec --only auth,firestore,functions,storage --project demo-filmovy-kviz-v2`, bez importu dat, s izolovanou CLI konfigurací; reálné Auth/API emulátory, nikoli nový fixture náhled. Emulátory se po testu ukončily.
- **PASS:** první scénář skutečně vytvořil 17 otázek, skončil se třemi koly a 27 uloženými slidy, prošel 26 přechody zkoušky i detail akce; druhý potvrdil čtyři uložené slidy proti zkoušce a live streamu. Oba bez page errors. Důkazy jsou v `.local-data/complete-editor/evidence.json` a `minimal-practice.json`.
- **PASS:** `pnpm check` (typecheck/lint/build), `pnpm test:unit` — 41 souborů / 377 testů, `node --check` a `git diff --check`. Discovery, timeouty, retries, výkonové limity, vizuální baseline, závislosti a runtime konfigurace se nemění.
- **FAIL, předexistující samostatný harness:** cílený `events-form-ux` scénář 1280×720 skončil na původním čekání na „Název akce“, ještě před změněnými assertions upozornění. Přímá browser diagnostika stejného lokálního harnessu doložila `can is not a function` a prázdné tělo stránky. Původní `events-form-ux.mocks.ts` již v base nevrací `can`, zatímco AdminShell jej používá. Nové textové assertions jsou proto běhově **NEOVĚŘENO**; zbývajících pět scénářů této sady se neopakovalo. Harness ani Auth mock se neopravují, protože nejde o přejmenování UI a sada není v hlavním CI. Nejmenší samostatný další zásah je obnovit kompatibilitu tohoto existujícího harnessu s Auth rozhraním a znovu ověřit jeho scénáře.

Logy a diagnostický snímek jsou pouze místní pod `.local-data/ui-cleanup/review-1d/`: `editor.log`, `check.log`, `unit.log`, `forms.log`, `forms-diagnostic.json` a `forms-diagnostic.png`; původní Playwright error context zůstává v `.local-data/events-form-ux/results/`. Nejsou publikovány ani commitovány.

Etapa 1D mění pouze dva uvedené testové soubory a tento report. Aplikace, CSS, workflow, Rules, data model, guardy, konfigurace i závislosti jsou proti výchozímu HEAD beze změny. Testovací cesty neodpovídají path filtru operátorského workflow; existující hlavní CI nadále testuje celý PR na lokálních demo emulátorech.

Konečné HEAD, nový CI run a jeho skutečný checkout budou po dokončení zaznamenány do popisu PR a závěrečného předání bez dodatečného dokumentačního commitu. Do té doby nejsou navazující boundaries, performance, dark-theme ani event-management kontroly vydávány za PASS. Nasazená aplikace a cloudový upload médií zůstávají mimo rozsah a neověřené.

## Etapa 1E — oprava Auth fixture a oddělené výsledky formulářů

Výchozí lokální/vzdálené HEAD `9e5aa2e8e0723f7065d2daaa0f4f06302bf9c053`, base `456f3eb62d5c52841afc3f055159711f279d11d3`, čistý worktree a Draft PR #33 byly znovu ověřeny. Předchozí hlavní [CI 35192104663](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/runs/35192104663) skutečně prošlo všech 25 definovaných kroků; tento historický PASS není výsledkem nového commitu.

Příčinu `can is not a function` potvrzuje původní runtime diagnostika a chybějící vlastnosti v `tests/browser/events-form-ux.mocks.ts`. Vite resolver v `apps/web/events-form-ux.vite.mjs` používá tuto náhradu pouze v samostatném formulářovém náhledu. Produkční sestavení ji neimportuje.

| Změněný soubor | Vazba na opravu |
| --- | --- |
| `tests/browser/events-form-ux.auth.ts` | Čistý testovací Auth profil typovaný přes `ReturnType` skutečného `useAuth` (pouze type import); kompletní uživatel, členství, loading/error stav a metody bez skutečného přihlášení. |
| `tests/browser/events-form-ux.mocks.ts` | Původní neúplný Auth objekt nahrazen tímto profilem; event data a API náhrady se nemění. |
| `tests/accessPermissions.test.ts` | Šest nových cílených případů v existující objevené unit sadě, bez změny discovery. |
| `tests/browser/events-form-ux.spec.ts` | Pouze kontrolní before/after hooky: HTTP/WS allowlist přesného lokálního originu, runtime a síťové důkazy, assertions na nulové chyby/provoz mimo náhled. Těla šesti původních scénářů zachována. |
| `docs/UI_CLEANUP_01.md` | Toto předání výsledků a samostatné překážky. |

`can` používá původní čisté `hasPermission` a podmínku aktivního členství. Výchozí admin má membership `manager` a pouze `event.read/create/manage`; moderátor pouze `event.read`. Neudělují se práva vlastníka, mazání, uživatelů, kontaktů ani kvízů. Event scope je omezen na `synthetic-event`, quiz scope je prázdný. Neznámý profil, neznámé/chybějící oprávnění i neaktivní členství se odmítají. Skutečné credential operace explicitně selžou lokálně; fixture nevrací použitelné tokeny. Unit testy ověřují povolené i zakázané akce, scope, konzistenci identity/stavu a odmítnutí Auth operací. Žádné `any`, potlačení typů, změna PermissionGate nebo nový autorizační systém.

### A. Původní formulářová sada — samostatný lokální výsledek

Nejprve spuštěn původně padající scénář 1280×720, poté všech šest scénářů přes původní Playwright/Vite konfiguraci a skutečné komponenty. Po opravě importu helperu do kořenové testovací složky je výsledný kód ověřen následujícím úplným během. Nastavení runneru, timeouty, retries, runtime verze a původní assertions zůstávají stejné; příkaz pouze ukládá JSON a trace pro diagnostiku.

| Původní scénář | Viewport | Výsledek a místo selhání | Retry |
| --- | --- | --- | --- |
| create and edit preserve the form contract and revision | 1280×720 | FAIL: vytvoření a přechod na detail proběhnou, ale pole na detailu není dostupné pro původní `toHaveValue`. | 0 |
| save errors retain values and native constraints prevent invalid submissions | 1280×720 | FAIL: detail se nevykreslí, čekání na vyplnění názvu dosáhne původního 30s timeoutu. | 0 |
| moderator stays read-only | 1280×720 | FAIL: detail se nevykreslí, chybí původně očekávaný nadpis. | 0 |
| both forms visual contract 1280x720 | 1280×720 | FAIL: všechny kontroly vytvoření projdou, poté chybí pole názvu na detailu. | 0 |
| both forms visual contract 1024x768 | 1024×768 | FAIL: všechny kontroly vytvoření projdou, poté chybí pole názvu na detailu. | 0 |
| both forms visual contract 390x844 | 390×844 | FAIL: všechny kontroly vytvoření projdou, poté chybí pole názvu na detailu. | 0 |

Celkem **0 PASS / 6 FAIL / 0 SKIP**, každý scénář spuštěn jednou v úplném běhu bez retry. Cílený běh 1280×720 má stejnou závadu. Ve všech šesti runtime důkazech je již jiná konkrétní chyba: `TypeError: Cannot read properties of undefined (reading 'started')`. Původní `can` chyba se neopakuje. Potvrzená příčina: datový `record` v původním fixture neobsahuje povinné `scoring`, zatímco `AdminEventDetailPage` čte `event.scoring.started`. Tato nekompatibilita event dat není Auth kontrakt, proto se podle rozsahu zadání neopravuje. Testy ani aplikace se jí nepřizpůsobují.

Nová očekávání „Testovací verze“ a upozornění na smyšlená data byla skutečně provedena a prošla na formuláři vytvoření ve všech třech viewports, spolu s jeho původními rozměrovými a klávesnicovými kontrolami. Na detailu zůstávají neověřena kvůli uvedenému pádu. Runtime chyby nejsou potlačeny: nové kontrolní hooky je navíc vykazují jako chybu. Síťové důkazy všech šesti případů mají nulový provoz mimo přesný lokální preview origin. Přihlašování ani Firebase cloud nebyly použity.

Nejmenší další zásah: samostatně sladit existující event datový fixture s aktuálním `EventRecord`, počínaje chybějícím `scoring`, zachovat assertions a znovu spustit všech šest scénářů. Staticky identifikovaný RefereeAccessPanel může po odstranění pádu zkusit vlastní API mimo původní aliasy; případný další běh jej musí nadále blokovat a vyhodnotit, nikoli maskovat úspěšnou odpovědí.

### B. Ostatní kontroly a předání

- Nezávislé cílené read-only review Auth kontraktu, oprávnění, zachování původních scénářů a rozsahu diffu: **bez nálezů**. Reviewer strojově potvrdil nezměněná těla scénářů a odstranění type-only Auth importu při transpilaci.
- `pnpm check`: **PASS**, včetně typové kontroly helperu, lintu a produkčního buildu; fixture v produkčním výstupu nenalezena.
- Cílená access unit sada: **10/10 PASS**, z toho **6 nových případů** Auth fixture.
- `pnpm test:unit`: **41 souborů / 383 testů PASS**.
- `pnpm test:rules`: **44/44 PASS**, čerstvý lokální Firestore emulátor `demo-filmovy-kviz-v2`, následně ukončen.
- Logy, JSON výsledky, runtime/network přílohy, screenshoty a trace pro všech šest případů zůstávají pod ignorovaným `.local-data/ui-cleanup/review-1e/`; nejsou commitovány ani uploadovány do PR.

Formulářová sada **není součástí hlavního CI**. Workflow se nerozšiřuje. Nový hlavní CI běh pro konečný commit, jeho checkout a vztah k HEAD/base budou zaznamenány v PR a závěrečném předání bez následného dokumentačního commitu. Změněné testové cesty neodpovídají filtru druhého operátorského workflow; oba workflow a jejich bezpečný demo/emulator režim jsou nezměněné.

Stav formulářového cíle zůstává **nedokončený kvůli samostatnému event fixture**. Není doložena připravenost k rozhodnutí o nasazení; cloudový upload a nasazená aplikace zůstávají neověřené. Bez merge, auto-merge, změny base, force push, deploye, Firebase cloudového přístupu a kontaktu s V1.

## Etapa 1F — úplné datové fixtures a revizní cyklus

Výchozí HEAD `6c599c44373b5aa4abd081b76acdbe66f7529194`, base `456f3eb62d5c52841afc3f055159711f279d11d3`, čistý worktree a Draft PR #33 byly ověřeny. Po prvním lokálním ověření se práce zastavila na předexistujícím chybném očekávání revize. Uživatel následně výslovně schválil přesnou opravu 3 → 1 a doplnění kontrol celého revizního cyklu; dosavadní datový diff byl zachován. Níže jsou výsledky opakovaného ověření konečného testového kódu.

Chybějící scoring skutečně porušoval platný kontrakt. `EventRecord` jej vyžaduje a skutečný `mapEvent` neúplné scoring odmítá; fallback v aplikaci by závadu pouze skryl. Další opravená data zahrnují počty účastníků, stav a publikování registrací, úplné odpovědi mutací, pražský čas a nepřiřazený kvíz jako vynechanou volitelnou vlastnost.

| Změněný soubor | Vazba na etapu 1F |
| --- | --- |
| `tests/browser/events-form-ux.data.ts` | Malá typovaná factory celého `EventRecord` a stav pro jedinou syntetickou akci. Používá skutečnou výchozí scoring konfiguraci, čistý validátor a `pragueInstant`. |
| `tests/browser/events-form-ux.mocks.ts` | Napojení načtení a zápisů na tento stav, typy skutečných API, úplné mutation envelopes, věrný záznam volání/odpovědí/načtených dat, chybové odpovědi bez zápisu a prázdný seznam přístupů rozhodčích. Auth profil zůstává nezměněný. |
| `tests/browser/events-form-ux.spec.ts` | Jediná schválená oprava původního očekávání vstupní revize 3 → 1 a cílené kontroly vytvoření 1, aktualizace 2 a opětovného načtení 2 v prvním scénáři. Ostatní scénáře beze změny. |
| `apps/web/events-form-ux.vite.mjs` | Pouze izolovaný testovací resolver: přesný import API z `RefereeAccessPanel` směřuje do fixture. Skutečná komponenta zůstává zachována; produkční build tuto konfiguraci nepoužívá. |
| `tests/eventsFormFixture.test.ts` | Devět cílených datových regresních kontrol ve vlastním souboru. |
| `vitest.config.ts` | Jediný nový řádek explicitního seznamu pro uvedený soubor; ostatní discovery a nastavení beze změn. |
| `docs/UI_CLEANUP_01.md` | Toto předání skutečných výsledků a blokujícího rozporu. |

Detail používá samostatný seed revize 2 se stavem `draft`. Vytvoření začíná bez uložené akce, vrací `EventMutationResponse` se stavy `scheduled` a revizí 1; následný `getEvent` vrací úplný mapovaný `EventRecord`. Aktualizace přijímá aktuální revizi, zachovává neformulářová data a vrací novou revizi. Formulářové transportní klíče se neukládají. Čtení klonuje vnořená data a stav se nesdílí mezi stránkami/scénáři. Syntetické selhání zápisu zachovává původní data i chybovou cestu formuláře. Seznam rozhodčích je legitimně prázdné `Access[]` pro akci bez vydaných přístupů; jiné operace explicitně selžou. Quiz seznam/detail mají původní prázdné odpovědi příslušných typů; oprávnění admina jejich načtení v těchto scénářích nevyžadují.

### A. Celá původní formulářová sada

| Původní scénář | Viewport | Výsledek | Retry |
| --- | --- | --- | --- |
| create and edit preserve the form contract and revision | 1280×720 | PASS: úplný revizní cyklus 1 → 2 a opětovné načtení. | 0 |
| save errors retain values and native constraints prevent invalid submissions | 1280×720 | PASS | 0 |
| moderator stays read-only | 1280×720 | PASS | 0 |
| both forms visual contract 1280x720 | 1280×720 | PASS | 0 |
| both forms visual contract 1024x768 | 1024×768 | PASS | 0 |
| both forms visual contract 390x844 | 390×844 | PASS | 0 |

Celkem **6 PASS / 0 FAIL / 0 SKIP**, bez retries, runtime chyb nebo požadavků mimo přesný lokální preview origin. Trace pro všech šest scénářů dokládá **89/89 provedených assertions PASS** včetně diagnostických hooků. Každý vizuální scénář provedl všech devět původních kontrol na vytvoření i detailu, včetně textu „Testovací verze“, přesného upozornění na smyšlená data, rozměrů, overflow a klávesnicového focusu. Původní funkční kontroly vytvoření, pending stavu, navigace, editace, negativních vstupů a read-only moderátora zůstávají zachovány.

**Zdůvodnění schválené opravy:** skutečné `functions/src/events/callables.ts` vytváří a vrací revizi 1. `AdminEventCreatePage` přejde na detail, který pouze načítá data; `AdminEventDetailPage` při editaci předává `event.revision` do `eventApi.updateEvent` jako `expectedRevision`. První aktualizace tedy musí poslat 1 a dostane 2; potvrzuje to i stávající `tests/e2e/events-emulator.mjs`. Historické očekávání 3 v prvním scénáři vzniklo tím, že starý mock při vytváření chybně upravoval seed revize 2. Opraveno je pouze toto konkrétní očekávání vstupního požadavku, nikoli jiné revize v testech.

První browser scénář nyní ověřuje načtenou novou akci s revizí 1, přesný update požadavek s revizí 1, skutečné odpovědi create/update s revizemi 1/2 a automatické načtení uloženého názvu s revizí 2. Následný návrat historií na `/admin/events/new` a vpřed na detail znovu připojí skutečnou komponentu a provede další repository čtení: formulář zachová upravený název a načtená akce revizi 2. Nejde o úplný reload browser dokumentu; stav izolovaného fixture žije po dobu stránky. Kontrola nezměněných vstupních volání dokládá, že při tomto opětovném načtení neproběhla další create/update mutace. Diagnostické logy kopírují skutečně vrácené hodnoty a stav neřídí.

### B. Regresní testy a lokální kontrola

- Nová datová sada: **9/9 PASS**. Ověřuje skutečný mapper/validátor včetně tří neplatných scoring vstupů, úplné create/update odpovědi a opětovné načtení, revize, zachování ostatních polí, pražský letní/zimní čas, selhání bez zápisu, nezávislé objekty a ID přístupů rozhodčích.
- Cílený běh datové a stávající access sady: **19/19 PASS**; dosavadní Auth testy zachovány.
- `pnpm check`: **PASS**, typová kontrola, lint a produkční build. Testovací fixture řetězce nejsou ve výstupu aplikace.
- `pnpm test:unit`: **42 souborů / 392 testů PASS**, proti 383 je to právě 9 nových případů v jednom souboru.
- Nezávislé read-only review datového diffu a následné cílené review schválené opravy/nových kontrol revize: **bez nálezů**. Reviewer potvrdil skutečný backend/aplikační kontrakt, absenci mezimutace a odstranění původního blockeru. Neměnil soubory a nespouštěl testy.
- Důkazy konečného běhu zůstávají lokální a ignorované pod `.local-data/ui-cleanup/review-1f/final/`: `contract.log`, `check.log`, `unit.log`, `forms.log`, `forms.json`, `forms-summary.json` a `forms-results` s trace/screenshoty. Původní neúspěšný běh zůstává odděleně v nadřazeném adresáři. Důkazy se neuploadují do PR.

### C. Hlavní Quality gate a předání

Lokální formulářový blocker je odstraněn. Konečný commit zahrne celý dosavadní datový diff i schválenou opravu a kontroly revize. Nový hlavní CI běh se nepředjímá: jeho úplný výsledek, konečné HEAD, base, run URL, skutečný checkout SHA a vztah případného merge ref k HEAD/base budou zapsány do PR a závěrečného předání bez následného dokumentačního commitu. Předchozí [CI 35197252108](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/runs/35197252108) není ověřením nového kódu. Samostatná formulářová sada nadále není součástí hlavního CI.

Obě workflow jsou beze změny; nové cesty neodpovídají path filtrům operátorského workflow. PR zůstává Draft se stejnou base. Žádný merge, auto-merge, force push, deploy, Firebase cloudový přístup ani kontakt s V1. Nasazená aplikace a cloudový upload médií zůstávají mimo rozsah a neověřené.
