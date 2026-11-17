# JUSTKVÍZ SHOW MODE — lokální předání 2026-10-15

**Aktualizace po předání:** verze `b456606` byla následně se souhlasem vlastníka
nasazena na V2 staging v rozsahu Hosting + 44 Functions a ověřena online.
Viz [záznam nasazení a QA](SHOW_MODE_STAGING_B456606.md).
Následující text zachovává historický stav lokálního předání před nasazením.

SHOW MODE je implementovaný v existující V2 aplikaci po schválení všech tří
návrhových obrazovek. Výsledkový overlay, ručně řízené finále, vítězný moment,
audio a synchronizace jsou propojené se skutečnými serverovými příkazy.
Nejde o původní HTML prototyp. Na staging ani jiný cloud se nic nenasazovalo.
V1, produkční data a produkční konfigurace zůstaly mimo rozsah práce.

## Verze a integrace

- Větev: `codex/show-mode-implementation`.
- Ověřený původní základ: `be81596eab2646dfe7760f6ce7625f37e1909b6f`.
- Schválená návrhová etapa: `9404e1c5e96b085af875c0eefb641247a6388c0e`.
- Server, společný protokol a backend testy: `ab6e615`.
- Integrovaný aplikační zdroj: `a45cec55d5e0dfe7f632b143a80353ab6429563c`.
- Dokumentace a inventář vydání následují v samostatném lokálním commitu.
  SHA aplikačního zdroje je také v `tools/show-mode/deployment-manifest.json`.

Lead integroval práci tří specialistů s odděleným vlastnictvím souborů:
vizuál/pohyb (GPT-6.1 Sol high), serverový engine (GPT-6.1 Sol high) a
audio/spolehlivost (GPT-6.1 Sol medium). Všechny tři části jsou dokončené.
Větev obsahuje místní commity; nebyla pushnuta ani nasazena.

## Co je hotové

- Průběžné výsledky nad ztmaveným bezpečným obrazem projekce, šest týmů na
  stránce, skutečný pohyb pořadím proti předchozí publikované verzi a návrat
  na původní slide včetně dříve odhalené odpovědi/recapu při trvajícím oprávnění.
- Finále od nejnižšího umístění, volitelné hromadné spodní pozice, ruční TOP 3,
  společná umístění a vítězové, stránkovaná historie a úplná tabulka po odhalení.
- Společný renderer moderátora a projektoru, zachovaný vzhled zamčeného kvízu,
  krátké CSS přechody, decentní/show/vypnutý pohyb a okamžitý statický režim.
- Pět vlastních MP3/WAV: znělka, otevření výsledků, napětí, odhalení, vítězové.
  Výběr/upload, uložení pro akci, zkouška, hlasitost, fade-in/out a okamžitý STOP.
- Jedna fronta příkazů v moderátorském pultu, potvrzené revize a serverové cue.
  Reload/reconnect/retry nespouští znovu zvuk ani ceremoniál. Další místo
  se nikdy neodhalí časovačem nebo dokončením audia.
- Aktuální serverová oprávnění, allowlist veřejných dat, ochrana dosud
  neodhalených týmů/odpovědí a privátních zvukových referencí. Klasický režim
  zachovává osm řádků a kompatibilní veřejný formát.

Kontrakt a hranice popisují [implementace](SHOW_MODE_IMPLEMENTATION.md),
[audio](SHOW_MODE_AUDIO.md), [architektura](ARCHITECTURE.md),
[datový model](DATA_MODEL.md) a [bezpečnost](SECURITY.md).

## Skutečně provedené kontroly

Všechny běhy používaly syntetická data, Node 22.23.2 a lokální demo emulátory.
Níže uvedené logy jsou relativní vůči `.local-data/show-mode-implementation/`.
Výsledky se nesčítají do jednoho zavádějícího počtu: některé scénáře opakují
stejné bezpečnostní hranice na jiné vrstvě.

| Kontrola | Výsledek | Evidence |
| --- | --- | --- |
| `pnpm check`: typecheck, lint, build | PASS | `check-final-1.log`, receipt `check-final-1-result.json` |
| Úplná jednotková sada | 603 PASS / 60 souborů | `unit-final-1.log` |
| `pnpm test:rules` | 50 PASS | `rules-integration-1.log` |
| SHOW server nad skutečnými emulátory | 7 skupin PASS | `browser-integration-2.log` |
| Autorizované audio/upload/gateway | 21 ověření PASS | `browser-integration-1.log` |
| Původní průběžné/final výsledky | 12 + 8 skupin PASS | `browser-integration-1.log` |
| SHOW browser, včetně 3 audio scénářů | 8 PASS | `browser-final-1.log` |
| Regrese celého večera | 1 rozsáhlý scénář PASS | `browser-regression-1.log` |
| Závěrečné rozlišení a layout po úpravě footeru | 3 PASS | `browser-visuals-final-2.log` |
| Archivovaný frontend před/po | 1 PASS | `browser-visuals-final-2.log` |

Browser ověřil reálné WAV uploady a přehrání přes nativní Web Audio,
autoplay odmítnutí a ruční fallback, překročené třísekundové okno při skutečně
zpožděném stažení, STOP, odpojení, odvolání přístupu, reload a souběžný druhý
panel bez samovolného zvuku. React StrictMode test ověřuje novou instanci
přehrávače po cleanup a nulové aktivní zdroje po unmount.

Výsledkové scénáře ověřily skutečný veřejný dokument, přesný návrat, remízy,
10 dlouhých společných vítězů ve stránkách 6+4, historii, bulk lower, static,
reduced motion, offline/reconnect a podvržený BroadcastChannel. Doménové
testy navíc procházejí 1 000 týmů / 167 stránek bez duplicit a ztrát.

Regrese celého večera prošla skutečný editor a ukládání vzhledu, immutable
snapshot po úpravách knihovny, bodování, 12 projektorových druhů slidu,
otázkové audio/video, publikaci a skutečný autorizovaný PDF endpoint.
Vygenerovala dvoustránkové týmové archy bez odpovědí a jednostránkový
odpovědní klíč. Evidence: `.local-data/whole-evening/evidence/design-evidence.json`
a `pdf-evidence.json`.

Po úplném `check` a unit běhu se v aplikaci změnila pouze rezerva místa footeru
pro fullscreen tlačítko. Browser helper nyní čeká na skutečný přepočet viewportu;
měřicí testy používají obvyklý medián průměrem dvou prostředních hodnot a baseline
naviguje mezi dvěma běžnými slidy. Finální tři browser scénáře a baseline tyto
změny pokrývají. Rules ani autorizační implementace se po odpovídajících
úspěšných kontrolách nezměnily.

## Naměřený výkon a jeho meze

Windows 11 (10.0.26200), Ryzen 9 8940HX, 32 logických CPU, 31 GiB RAM,
Chromium 151.0.7922.34 headless, 1920×1080. Projektor měl 6× CPU throttling,
moderátor běžel bez něj. Oba testy používají produkční Vite build,
skutečné lokální emulátory, warm-up a čtyři střídavé vzorky každé varianty.
Měřeno od skutečného fetch příkazu k DOM projektoru; RAF a Long Tasks
se sledují následně. Záznam videa i emulátory přispívají k režii.

### Původní a aktuální frontend

Archiv obsahuje skutečný web **i quiz-domain** z `9404e1c`, sestavený současnými
lokálními build nástroji. Oba weby používají **stejný aktuální backend**.
Toto je porovnání frontendových zdrojů, nikoli historického backendu.
Čistý Next scénář přechází mezi běžnými slidy 3→4, bez audio callbacků.

| Metrika | Původní frontend | Aktuální frontend | Rozdíl aktuální − původní |
| --- | ---: | ---: | ---: |
| Next, medián | 163,70 ms | 160,60 ms | −3,10 ms |
| Next, p95 / maximum | 195,00 ms | 170,90 ms | −24,10 ms |
| Klasická publikace, medián | 262,90 ms | 262,20 ms | −0,70 ms |
| Klasická publikace, p95 / maximum | 280,40 ms | 276,50 ms | −3,90 ms |
| RAF p95 | 6,20 ms | 6,20 ms | 0 ms |
| Long Tasks nad 50 ms | 0 | 0 | 0 |

V tomto malém čistém vzorku není patrná regrese navigace a klasické publikace.
Rozdíly mediánů jsou blízko běžné variabilitě; nejsou důkazem obecného zrychlení.

První měření se přechodem audio slide 2→běžný slide 3 zachováváme v
`.local-data/show-mode-baseline/evidence/before-after-audio-origin.json`:
Next medián 161,45→191,00 ms (**+29,55 ms**), klasická publikace
261,55→269,15 ms (**+7,60 ms**). Callbacky otázkového přehrávače jsou
v tomto scénáři další proměnnou. Výsledek nebyl odstraněn ani zaměněn za
čistý navigační benchmark; také ukazuje variabilitu lokálních běhů.

### Klasický renderer a SHOW ve stejném aktuálním buildu

Tento samostatný test izoluje prezentační variantu nad stejnými šesti týmy.
Nejde o srovnání předchozího checkoutu s novým.

| Metrika | Classic | SHOW | Rozdíl SHOW − Classic |
| --- | ---: | ---: | ---: |
| Příkaz → DOM, medián | 266,65 ms | 265,20 ms | −1,45 ms |
| Příkaz → DOM, p95 / maximum ze 4 vzorků | 269,50 ms | 288,00 ms | +18,50 ms |
| RAF p95 | 6,20 ms | 6,20 ms | 0 ms |
| Nejdelší jednotlivá RAF mezera | 18,20 ms | 30,40 ms | +12,20 ms |
| Long Tasks nad 50 ms | 0 | 0 | 0 |

SHOW měl v tomto běhu téměř stejný medián, ale horší nejpomalejší odezvu
i nejdelší RAF mezeru. Z těchto čtyř vzorků nelze tvrdit zrychlení ani
statisticky prokázanou rovnost. p95 je při n=4 maximum. Headless RAF kolem
6,2 ms není důkaz FPS fyzického projektoru. CPU throttling nenahrazuje
konkrétní starý notebook, GPU ani síť v sále.

Zdrojová data: `.local-data/show-mode/evidence/performance-classic-versus-show.json`,
`environment.json` a `.local-data/show-mode-baseline/evidence/before-after.json`.
Vite stále hlásí velký hlavní chunk; tento problém existoval už v původním
frontendovém buildu. Nebyla přidána animační knihovna ani nová závislost.

## Screenshoty a skutečný pohyb

Snímky pocházejí z implementace nad emulátory, nikoli z návrhového HTML.
Vizuálně je zkontroloval lead i vizuální agent v 1920×1080 a 1280×720.
Všechny cesty jsou pod `.local-data/show-mode/evidence/`:

| Obraz | Snímek | Video skutečného browser scénáře |
| --- | --- | --- |
| Průběžné výsledky | `interim-1920.png`, `interim-1280.png` | `videos/interim-controls.webm` |
| Finální odhalování | `finale-1920.png`, `finale-1280.png` | `videos/finale-reveal.webm` |
| Vítězný moment | `winner-1920.png`, `winner-1280.png` | `videos/finale-reveal.webm` |
| Více dlouhých společných vítězů | `six-long-co-winners-1920.png`, `four-long-co-winners-1280.png` | `videos/long-co-winners.webm` |
| Moderátorský pult | `moderator-768.png` | `videos/classic-to-show-replacement.webm` |

Syntetické názvy akcí jsou testovací obsah. Uživatelovy tituly, barvy,
fonty, logo a pozadí se přebírají z existujícího zamčeného vzhledu kvízu.
Evidence zůstává lokálně v ignorovaném adresáři, nevstupuje do web buildu.

## Opravené nálezy a omezení

Během integrace byla opravena kolize CSS intro třídy, StrictMode životnost
audio controlleru, prodleva automatického zvuku po stahování, public classic
kompatibilita a překrytí footeru fullscreen tlačítkem. Testy navíc potřebovaly
čekat na skutečné potvrzení hide a změnu rozlišení; samotné čekání na klik
nebo API setViewport nestačilo. Původní neúspěšné logy zůstávají zachované.

- Zvuk vychází z moderátorského prohlížeče. Ověřen je nativní start/stop a
  souběh zdrojů, nikoli slyšitelnost reprosoustavy nebo fyzické AV zapojení.
- Automatický zvuk vyžaduje gesto, čerstvé potvrzení přesné revize/cue a
  dokončené stažení/dekódování do tří sekund od kliknutí. Jinak zůstává
  ruční přehrání. Autoplay pravidla prohlížeče nelze obejít.
- Ověření oprávnění audio panelu se obnovuje po dvou sekundách; serverová
  kontrola média probíhá při každém čtení. Reakce již hrajícího místního
  zdroje na revokaci má tuto polling prodlevu.
- Každý ručně obsluhovaný moderátorský prohlížeč má vlastní audio výstup.
  Firestore řídí stav show, nikoli síťovou synchronizaci PCM nebo globální
  mixáž více počítačů. Pro živý večer používat jeden zvukový pult.
- UI potvrzuje publikovaný stav a vydaný animační pokyn. Neprohlašuje
  fyzické dokončení animace na vzdáleném projektoru bez potvrzovacího kanálu.
- Při obnovení projekce se otázkové médium automaticky nerozehraje; pokračuje
  až dalším ručním Play. Návrat odpovědi je podmíněn aktuálním oprávněním.
- Fyzický projektor, skutečný sál a slabší notebook nebyly k dispozici.
  Cloudová kompatibilita a reálná staging infrastruktura nebyly čteny.

## Připravený rozsah vydání pro V2

[Inventář vydání](../tools/show-mode/deployment-manifest.json) uvádí Hosting
a přesných 28 Functions, z toho dvě nové: `configureEventShow` a
`readEventShowPreferences`. Rozsah zahrnuje přímé i nepřímé konzumenty
změněného live parseru, lifecycle a media gateway. Rules, indexy, secrets,
produkční projekt, migrace a automatický cleanup nejsou součástí vydání.

Manifest je evidence rozsahu, nikoli povolení nasazení. `projectId` je null
a všechny cloud/deploy approval hodnoty jsou false. Před případným budoucím
nasazením je nutné schválení konkrétní verze a cíle, pak příslušný staging
preflight a sestavení s cílovou konfigurací. Lokální demo bundle se nenasazuje.
Současné otevřené webové panely musí před použitím SHOW MODE načíst nový web.

Reprodukce: `pnpm check`, `pnpm test:unit`, `pnpm test:rules`; se spuštěnými
demo Auth/Firestore/Functions/Storage emulátory také `pnpm test:e2e:show-mode`,
`pnpm test:e2e:show-audio`, `pnpm test:e2e:show-browser` a
`pnpm test:e2e:whole-evening`. Baseline má samostatný Playwright config
`tests/browser/show-mode-baseline.config.ts`. Použít Node 22, explicitní
loopback Storage host, lokální prostředí a dostatečně krátký zapisovatelný
TEMP. Bez těchto lokálních podmínek fixture selhávají uzavřeně.
