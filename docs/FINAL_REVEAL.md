# Finální vyhlášení

## Automatický krok před závěrem (2026-10-19)

V moderování akce je finále odvozeným předposledním krokem prezentace. Tlačítko
Další před závěrečným slidem načte aktuální serverový náhled, ověří úplnost bodů
a zahájí pevně nastavenou show. Kvíz ani jeho neměnný snapshot se nepřepisuje.
U starého kvízu bez závěrečného slidu následuje finále po posledním obsahu a
Další po konečné tabulce ukončí session. Knihovní zkouška bez akce body nemá.

Moderátor už nevybírá styl, zvuk ani rozsah výsledků. Server vždy používá show
vzhled; klient postupně odhalí skupiny od poslední k vítězům, projde všechny
stránky remíz a zobrazí konečnou tabulku. Další během odhalování nepřeskočí
zbývající týmy. Předchozí vrací na poslední otázku/rekapitulaci; po tabulce
Další pokračuje na závěrečný slide. Neúplné body spuštění zablokují.

Automatické časování vlastní pouze okno, které finále spustilo. Obnovení stránky
ani cizí moderátor nespouští zvuk či odhalování; nabízí Pokračovat. Novější cizí
příkaz nebo chyba spojení automatické pokračování zastaví. Každý krok vyžaduje
serverové potvrzení revize. Fanfára vítězů používá stávající místní přehrávání
a před spuštěním ověřuje aktuální session a zveřejněnou verzi.

Ověření: `eventNightFlow.test.ts`, `eventNightControls.test.tsx`,
`liveModeratorView.test.tsx` a scénáře `show-mode-emulator.mjs`.

## Původní ruční kontrakt (zachovaný pro kompatibilitu)

Akce → Otevřít moderování akce → `/admin/live/:sessionId` → **Finální vyhlášení**.
Používá tutéž navázanou session a `/projector/:sessionId`. Po poslední otázce či
recapu načtěte **Načíst konečný náhled**, zkontrolujte všechny stránky soukromé
tabulky a stiskněte **Zahájit vyhlášení**. Před tím neukončujte session.
Samotný konec kola ani závěrečný slide nic nepublikuje a neprovádí END.

Po dokončení akce otevřete na jejím detailu **Konečné výsledky**. Jde o
[historický read-only souhrn](HISTORICAL_RESULTS.md) potvrzené verze, nikoli
obnovení session nebo nové vyhlášení.

Projektor nejprve ukáže neutrální úvod. Každé **Odhalit další umístění** odhalí
jednu skupinu od posledního dense umístění k prvnímu. Pořadí 1/2/2/3 tedy odhalí
3 → oba týmy na 2 → vítěze. Ruční stránky po osmi týmech nemění odhalené
umístění. Jeden tým i všichni první jsou jedna skupina; více vítězů má množný
text. Celá tabulka přes sdílený `ResultsTable` vyžaduje dokončené odhalování
a explicitní **Zobrazit celé konečné pořadí**. **Ukončit kvíz** zůstává ruční
stávající END. Po END nelze finále ani session obnovit.

## Jediný výpočet a potvrzené verze

`calculateFinalResults` používá existující `calculateResults`, jen zahrne všechna
kola immutable snapshotu včetně posledního. Přijaté ruční i online registrace
mají stejné zacházení; stabilní ID, celočíselné půlbody, vyšší součet první,
dense ranking a stabilní NFC název/ID uvnitř shody zůstávají stejné. Chybějící
nebo null skóre není nula. Náhled vypíše konkrétní tým/kolo a neúplná či prázdná
tabulka je blokovaná. Jednokolové finále funguje; omezení průběžných výsledků
posledním kolem se nemění. Nevzniká druhá evidence skóre.

`previewFinalResults` čte soukromý náhled. `controlFinalReveal` při start/replace
v jedné transakci znovu ověří aktuální Auth staff roli a disabled stav, vazbu
event/session/snapshot, lifecycle, přijatý roster, úplnost, session revizi
a fingerprint všech zahrnutých kol, týmů/názvů/revizí a skóre. Změnu mezi
náhledem a potvrzením odmítne. Nikdy nepřijímá klientské výsledkové řádky,
požadované umístění nebo index odhalení.

- `sessions/{id}/finalVersions/{versionId}`: privátní neměnná potvrzená tabulka,
  fingerprint, kola, vazby, aktér/čas a `replacesVersionId`.
- `sessions/{id}.finalReveal`: privátní pointer versionId, visible, mode,
  revealedCount/totalGroups, rank a page/pageCount. Skrytí zachovává postup.
- `sessions/{id}/finalOperations/{operationId}`: privátní audit/idempotentní
  receipt podle existujícího hash helperu z UID/session/request ID. Žádné
  klientské zápisy nejsou povolené.

Každý příkaz posílá přesnou `versionId` (null pouze první start), očekávanou
session revizi a request ID. Server sám odvodí další skupinu z uložené verze.
Dva rozdílné příkazy na stejné revizi nemohou oba uspět. Dokončený retry se
stejným obsahem pouze potvrdí starou operaci s `replayed: true` a bez oprávnění
spustit fanfáru; nepřidá audit, neobnoví skrytý výstup a nezmění novější verzi.
Jiný obsah stejného ID odmítne. Po END nebo uzavření akce odmítá i retry.

## Opravy a lifecycle

Rozběhnuté odhalování čte uloženou verzi. Oprava rozhodčím, přejmenování či změna
přijetí týmu ji nepřepočítá. Panel ukazuje ID a postup verze; soukromé odběry
skóre/registrací spouštějí kontrolní čtení fingerprintu a upozorní na rozdíl.
Nedostupné ověření je viditelně označené, nikoli vydávané za shodu.

**Skrýt finále** odstraní veřejný výstup a zastaví fanfáru, ale zachová verzi,
režim, skupinu i stránku. **Pokračovat ve stejné verzi** obnoví tentýž obsah.
Pro opravu načtěte nový náhled, zaškrtněte upozornění na nový začátek a použijte
**Nahradit finále a začít znovu**. Nová verze začíná prázdným úvodem; historie
staré verze zůstává. Nejde o restart ukončené session.

Start/replace/resume odstraní průběžnou tabulku. Dokud je finále viditelné,
průběžné výsledky i běžné navigační/mediální příkazy vyžadují nejprve hide.
Start, hide a resume používají existující navigační lifecycle na stejné pozici:
vyčistí reveal/recap, zvýší generaci a nastaví média idle. END/cancel/archive
atomicky odstraní veřejný payload a skryjí privátní pointer. Staré callbacky
nejsou platné. Dokončení odhalování ani zvuku nikdy neukončuje session.

## Veřejná hranice

`publicSessions/{id}.finalReveal` je výslovný allowlist: versionId, mode, rank,
page/pageCount, velikost právě odhalené skupiny a aktuálních nejvýše osm řádků
`rank/teamName/halfPoints`. Úvod má prázdné rows a žádné údaje o budoucích
umístěních. Skupina obsahuje jen zvolenou stránku tohoto umístění; celá tabulka
je také stránkovaná a vyžaduje dokončení a příkaz table. Budoucí řádky nejsou
v síti, DOM, CSS ani veřejné kolekci verzí. Kontakty, ID týmů, staff UID,
capability tokeny, jednotlivá skóre, historie, snapshot a odpovědi zůstávají
privátní. Verze ani receipt nesmí číst anonymní klient ani se známým ID.

Stávající Rules pro privátní sessions dovolují jen staff čtení a zakazují
veškeré přímé zápisy. Referee a registrační management token nejsou staff
oprávnění. Firestore je jediná autorita projektoru; finále využívá stávající
ochrany před BroadcastChannel podvrhem, cache-only daty, cizí session, starým
callbackem a nižší revizí. Offline vyčistí výstup; reconnect načte server.
Detekce výpadku může trvat. Již doručená data nelze divákovi zpětně odebrat.

## Fanfára

Originální krátký syntetický motiv přes Web Audio, bez knihovny a externího
zdroje. AudioContext se připravuje jen při uživatelském kliknutí. Automatický
pokus nastane až po čerstvém úspěšném odhalení prvního místa a následném
serverovém ověření přesné verze/revize a viditelnosti. Hraje jen iniciující
panel. Projektor, náhled, druhý panel, snapshot, reload, reconnect, retry,
stránkování ani resume hudbu nespouštějí. Remíza má jeden pokus pro skupinu.

Panel má **STOP fanfáry**, ruční přehrání po vítězích, hlasitost s výchozí
hodnotou 0,12 (maximum 0,3) a ztlumení. Stav „přehrává se“ vyžaduje running
AudioContext a úspěšné naplánování tónů. Odmítnutí ukáže skutečné tlačítko pro
nový ruční pokus. STOP, hide, END, změna verze a odchod invalidují opožděné
pokusy a zastaví zvuk. Selhání zvuku neblokuje příkazy ani END. Žádná smyčka.
Přesně jednou slyšitelný zvuk nelze zaručit za všech síťových/hardwarových podmínek.

HTTP potvrzení callable může předběhnout Firestore stream. Jednorázové
`getDocFromServer` sdílí existující odběr a může ještě vrátit starší serverovou
revizi. Před zvukem proto panel provede samostatné serverové čtení v read-only
transakci. Nečerpá z opožděného listeneru a nemění session ani další data.
Ověří přesnou revizi/verzi, viditelnost i dokončené odhalení. Novější stav nebo
lokální STOP/hide/END/nahrazení/unmount pokus zneplatní. Potvrzení nezačne
přehrávat jen kvůli pozdějšímu doručení snapshotu. Selhání čtení nabídne ruční
pokus; ochrany se znovu ověřují i po asynchronním resume zvukového kontextu.

Hlasitost a mute mění aktivní výstupní gain. Po dohrání/STOP se tento uzel
odpojí; změna ovladače se použije v příštím novém audio grafu. QA musí měřit
připojený výstupní gain, nikoli očekávat změnu hodnoty starého odpojeného uzlu.
Browserové testy počítají až úspěšná nativní spuštění oscilátorů, sledují osm
gain uzlů (výstup + sedm obálek), ukončení a odpojení výstupu. Závod revizí
reprodukují pozdržením skutečných Firestore bajtů proti emulátoru, bez změny
callable odpovědí nebo nahrazení zvukového enginu.

## Testy a budoucí nasazení

Doménové/zvukové unit testy, Rules testy privátních verzí a receipt, transakční
`tests/e2e/final-reveal-emulator.mjs` a verzovaný Playwright
`tests/browser/final-reveal.spec.mjs` běží ve standardním CI v novém úzkém kroku.
Fixture vyžaduje `demo-*` a lokální Auth/Firestore/Functions před inicializací
SDK. Browser blokuje nelokální síť. Syntetické účty a data jsou pouze emulátorové.

Browser ověřuje 1920×1080, 1280×720, moderátora 768 px, dlouhé názvy, remízu
přes stránky, skutečné anonymní payloady, dva panely, referee korekci, skrytí,
reconnect, nahrazení a řízení Web Audio včetně odmítnutí/STOP/pozdní odpovědi.
Jde o simulované viewporty a zvukové řízení, nikoli poslech na HDMI/reproduktorech.
Limit zůstává 1000 týmů, osm řádků na stránku. Extrémně dlouhé názvy jsou
vizuálně omezené na dva řádky; celý název zůstává v textovém modelu/title.

Tato feature se nenasazuje. Budoucí samostatně schválený deploy musí zahrnout
web, nové `previewFinalResults`/`controlFinalReveal`, změněné
`controlInterimResults`, všechny live mutation exports (`goToSlide`, `nextSlide`,
`previousSlide`, `revealAnswer`, `hideAnswer`, `selectRecapQuestion`, `playMedia`,
`stopMedia`, `replayMedia`, `finishMedia`, `startIntro`, `endLiveSession`),
`reportMediaPlayback`, `cancelEvent` a `archiveEvent`. Jsou závislé na parseru
nového pointeru, lifecycle a vzájemném vyloučení výstupů. Rules/indexy, role,
secrets a závislosti se nemění; migrace ani cloudové credentials CI nejsou třeba.

## Moderator navigation and event completion, 2026-10-20

Finale remains an explicit reviewed publication inside an active event-bound presentation. It is entered before presentation END; END closes only that presentation and hides its public results. Event completion is a separate manual event-settings action, not a side effect of END. Scores, confirmed result versions and event publication survive presentation END. A new presentation of the same open event can review and start a new finale.

An explicit goToSlide jump can dismiss a visible interim/finale in the same trusted transaction. It clears interim state/return intent/show cue, retains a hidden private final-version pointer, resets answers/recap/media, and publishes only the selected unrevealed snapshot slide. Invalid/stale/foreign jumps leave existing presentation unchanged. Adjacent next/previous commands still require the overlay to be hidden first.

The moderator's question navigator groups private snapshot questions by round and includes a direct finale shortcut. Normal forward navigation enters the same virtual penultimate step. After its final table, Next goes to the closing slide (or the closed presentation when a legacy quiz has no closing slide), including when the finale was selected early. Missing scores remain an actionable error instead of fabricated final rankings.

Every fresh rank reveal explicitly requests animation; the winner receives a trophy and bounded confetti respecting reduced motion. The initiating moderator mounts the visible official Queen YouTube player only after a fresh confirmed winner publication and server recheck, using the 1:00–1:42 chorus excerpt. Refreshing, another operator's snapshot, or a replayed command never starts music. The music may continue over the final table; leaving the finale, ending the session, or stopping it locally removes/stops playback. YouTube availability and browser autoplay permission remain external constraints; the player exposes manual play when blocked. This replaces the synthesized fanfare in the simplified event controls without changing question media or the optional advanced panel.
