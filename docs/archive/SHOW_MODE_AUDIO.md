# SHOW MODE — vlastní zvuk akce

Lokální implementace používá stávající chráněné quiz assety MP3/WAV, upload granty
a ověření obsahu. Nepřidává závislosti, veřejné download tokeny ani externí hudbu.
Neproběhlo nasazení ani cloudová aktivace.

## Nastavení a soukromá hranice

`events/{eventId}.showPreferences` obsahuje sdílené `schemaVersion: 1`, motion
`none | subtle | show`, lowerRanks `step | bulk`, topThree, winnerAnimation,
audioEnabled, volume 0–1, fadeInMs/fadeOutMs 0–2000 a částečnou mapu **přesně pěti**
cue: `intro`, `interim`, `suspense`, `reveal`, `winner`. Výchozí hodnoty jsou
subtle / step / true / true / audio vypnuté / 0,25 / 300 ms / 500 ms.

`readEventShowPreferences({eventId})` vrací pouze eventId, revision a preferences.
`configureEventShow({eventId,expectedRevision,preferences})` vyžaduje přesnou revizi,
platný úplný strict objekt a aktuální `event.live` v rozsahu této akce. Transakce
znovu kontroluje aktuální členství, čerstvý Auth účet a provozní stav akce. Revize
akce se při úspěchu zvýší. Nezapisuje do publicSessions ani výsledků.

Nově připojený soubor navíc vyžaduje `quiz.read` a rozsah zdrojového kvízu.
Odpověďové médium vyžaduje také `quiz.answers.read`; nezveřejněný nepřipojený
upload smí bez této permission připojit pouze jeho autor s `quiz.media.upload`.
Každý uložený cue musí být ready audio/mpeg nebo audio/wav, do 25 MiB, s platnou
číselnou immutable generation. `showAudioBindings` drží serverem odvozené dvojice
reference/generation; klient je neposílá a narrow read je nevrací.

Existující event link lze ponechat bez nového přístupu ke zdrojovému kvízu.
Připojení nové reference neuděluje právo číst knihovnu, snapshot ani odpovědi.
Přímé zápisy klienta zůstávají zakázané stávajícími Rules.

## Gateway

`readQuizMedia?eventId=...&reference=quiz-asset:...` vyžaduje Bearer Auth token.
Kontext eventId se nesmí kombinovat se sessionId ani snapshotId. Gateway před IO
ověří fresh Auth, aktuální `event.live`, event scope a provozní stav, přesnou
aktuální cue referenci a připravenou uloženou generaci. Čte konkrétní Storage
generation a po IO opakuje fresh Auth i celý event/config/generation check.
Odebrání cue, změna generace nebo odvolání přístupu tedy blokují pozdní odpověď.
Hlavičky zůstávají no-store/nosniff, podporované byte ranges zůstávají omezené.
Žádný anonymní show-audio přístup nevzniká.

Public image gateway navíc dovoluje pouze aktuální normalizované obrázky v
serverovém `interimBackdrop`: design background/logo, backgroundImage a
questionImage pro obrazový druh slidu. Strict backdrop parser odmítá answer/media
extra fields; v této cestě nejsou povolené audio ani video soubory.

## Moderátorský panel a přehrávač

`ShowAudioPanel` je část existujícího moderování, nikoli nová administrační stránka.
Obsahuje nastavení celého show mode a pět voleb souboru. Picker znovu používá
`listQuizMedia` a `uploadQuizMedia`, se stejnými upload granty a serverovým
finalize; dovoluje výběr z knihovny nebo soubor, nemá vstup pro URL. Soubor se
přiřadí až explicitním uložením. `data-save-state="saved"` a text „Nastavení show
uloženo.“ potvrzují až úspěšný serverový save.

Narrow read se obnovuje každé dvě sekundy a při změně identity. Selhání přístupu,
offline, odhlášení, odebrání přiřazeného cue a unmount okamžitě zastavují lokální
zvuk. Již přijaté bajty nelze zpětně odebrat; detekce odvolání mezi kontrolami není
okamžitá. Lokální drafty/uploady se při změně identity ruší. Epoch chrání pozdní
read/save odpovědi před obnovením starého přístupu nebo draftu. Polling nepřepisuje
lokální změnu hlasitosti a nevytváří žádný cue.

`ShowAudioController` používá Web Audio decodeAudioData → jeden BufferSource →
jeden Gain → lokální destination. Nesměruje hudbu na projektor. Nemá smyčku,
přehrávání po konci zdroje uklízí uzly. Status playing vzniká až po úspěšném
decode, running AudioContext a přijatém source.start(). Nenahrazuje fyzický poslech.
Autoplay refusal nebo přerušený context ukazuje ruční fallback; neprovádí retry
bez dalšího gesta. Chyba dekódování/přístupu neblokuje ostatní příkazy moderování.
STOP je okamžitý. Samostatné plynulé zastavení respektuje fadeOut, ovladač volume
mění aktivní gain a ruší starší rampu. Při novém cue nejprve zanikne starý výstup.
Download má abort a limit 30 sekund; STOP, změna cue a epoch zneplatní i pozdní
resume/decode, které samotný browser neumí přerušit.

Každý effect setup panelu získá novou instanci controlleru; cleanup ji trvale
dispose a odstraní z ref i integračního callbacku. React StrictMode tedy při
setup → cleanup → setup znovu použije pouze UI facade, nikoli již zneplatněný
audio controller. Stará instance nikdy neobnoví výstup ani po pozdní odpovědi.

## Integrační API

Ruční obsluha: v existujícím moderování zapnout SHOW MODE, otevřít „Nastavení
SHOW MODE a vlastní MP3/WAV“, vybrat nebo nahrát soubor pro požadované cue,
povolit zvuk a uložit nastavení show. Před večerem použít jednotlivá tlačítka
„Přehrát: …“ a ověřit skutečný výstup. „STOP zvuku“ končí okamžitě, „Plynule
zastavit“ používá nastavené doznění. Nulová hlasitost a vypnutý zvuk nespouštějí
nový zdroj. Při blokaci prohlížeče je nutné nové ruční kliknutí; nečekat na retry
nebo reload. Přepnutí mimo show, změna slidu, přehrání otázky a END zvuk zastaví.

Panel přijímá `eventId`, `quizId`, `canUpload`, `canAttach`, `canPlay()`,
`onPreferencesChange(preferences)` a `onController(controller | null)`.
Guard canPlay musí zahrnout aktivní i připravované médium otázky a odpovídající
lokální suppress stav. Root musí před všemi question/show přechody zavolat STOP.

Suppression je svázaná se sessionId a konkrétní mediaGeneration. Příchozí jiná
generace ji ruší; je-li otázkové médium v preparing/ready/playing, zastaví i již
aktivní show výstup. Pending Play/Replay je blokovaný synchronním ref ještě před
potvrzením serveru. Pouhý trvale uložený boolean by byl chybný: jiný panel by mohl
spustit novou mediální generaci a staré potlačení by dovolilo souběh.

Controller poskytuje `prepareGesture(): number`, `playCue(cue,token,allowed?)`,
`stopImmediate()`, `stop()`, `updateVolume()` a `dispose()`.
`prepareGesture` musí běžet přímo uvnitř původního kliknutí před čekáním na server.
Vrací jednorázový epoch token a je tiché. Teprve čerstvé úspěšné potvrzení přesné
serverové verze/revize smí zavolat `playCue`. STOP token zneplatní; stejné potvrzení
se nedá znovu spotřebovat. Root guard navíc odmítá replayed receipt, starou verzi,
revizi, hide/END, cizí panel a pozdní odpověď. Snapshot/reload/reconnect nikdy
nehrají zvuk. Aktivní vzdálené VIDEO nemá automatický cue; po bezpečném zastavení
je dostupné nové ruční přehrání. Tato pravidla jsou v root integraci, samotný
controller neumí ověřit Firestore revizi.

Automatický pokus má navíc limit tří sekund od původního kliknutí a kontrolu
čerstvého `showCue.id`. Guard se ověřuje také po downloadu/decode; pomalý soubor
nesmí později sám začít hrát nad nezměněnou revizí. Další výslovné ruční přehrání
používá nový gesture token a není vázané na staré automatické časové okno.

Obě nové Functions jsou exportované v indexu a uvedené v eventLive access
policy registry. Jakékoli případné nasazení celé feature nadále vyžaduje samostatné
explicitní schválení; tento dokument není pokyn k deployi.

## Lokální ověření

`tests/showAudio.test.ts` pokrývá jednorázové tokeny, silent prepare, abort při STOP,
pozdní download/decode/browser resume, mute/volume, disabled/absent cues,
autoplay rejection, revocation/config replacement, cleanup a překrytý fade stop.
`tests/showAudioSecurity.test.ts` pokrývá strict pětici cue, neplatné URL/rozsahy,
ready MIME/velikost/generation, přesnou event vazbu a event.live/scope kontrolu
gateway v transakci včetně následného odebrání cue/změny generace/odvolání/uzavření.
Test gateway používá injektovaný lokální Firestore mock, žádné credentials.
`tests/mediaStorage.test.ts` znovu ověřuje dosavadní mediální contract.

Finální lokální gate 2026-10-15 prošel na Node 22.23.2 / Vitest 4.1.11:

| Ověření | Výsledek | Evidence pod `.local-data/show-mode-implementation/` |
| --- | --- | --- |
| Typecheck, ESLint, produkční build (`pnpm check`) | PASS, exit 0 | `check-final-1.log`, `check-final-1-result.json` |
| Kompletní unit suite včetně audio, security a StrictMode | 603 testů / 60 souborů PASS, 34,62 s | `unit-final-1.log` |
| Firestore Rules emulátor | 50 testů PASS, 12,10 s | `rules-integration-1.log` |
| Skutečné audio callable / Storage / gateway kontrakty | 21 assertions PASS | `browser-integration-1.log`, suite `show-audio-emulator` |
| SHOW MODE browser, včetně všech tří audio scénářů | 8 scénářů PASS, 2,1 min | `browser-final-1.log`, `browser-final-1-result.json` |
| Celovečerní editor / scoring / výsledky / PDF regrese | 1 scénář PASS, 1,5 min | `browser-regression-1.log` |

`showAudioPanel.test.tsx` renderuje skutečný React StrictMode setup/cleanup,
ověřuje odlišné nově získané instance, spuštění mock zdroje, externí media guard,
nejvýše jeden aktivní výstup a trvalé zneplatnění po unmountu.
`tests/e2e/show-audio-emulator.mjs` vytváří skutečný callable source quiz,
upload grant a WAV upload přes Storage SDK; všechny fixtures fail-closed vyžadují
lokální emulátory a demo projekt. Browser sada `tests/browser/show-audio.spec.mjs`
provádí pět skutečných uploadů, save/reload a instrumentuje nativní AudioContext
decode/BufferSource start/stop/gain bez nahrazení zvukového enginu. Potvrzuje
čerstvou publikaci, tichý retry/druhý panel/reload, hlasitost přes config polling,
STOP/offline/unmount/revocation a interlock otázkového audia. Třetí scénář zadržuje
skutečné chráněné gateway bajty přes tři sekundy při neměnné revizi: automatický
pokus zůstane tichý a následné výslovné ruční přehrání úspěšně dekóduje a spustí
nový zdroj. Předchozí neúspěšné integrační běhy zůstávají uložené odděleně;
finální PASS je výše uvedený `browser-final-1.log`.

Unit test ani nativní AudioContext graf nepotvrzuje fyzickou hlasitost, HDMI
směrování a poslech na cílovém zařízení. Audio je lokální ve zvoleném moderátorském
prohlížeči a jeho výstupním zařízení. Již přijaté bajty nelze zpětně odebrat;
odvolání během přehrávání se projeví po zjištění změny přístupu, obvykle při
dalším dvousekundovém pollu. Dlouhý komprimovaný soubor se dekóduje celý do paměti;
limit 25 MiB nahraných dat nezaručuje stejnou velikost dekódovaného audia.
Před použitím je nutný poslech a ověření zátěže na cílovém notebooku a ozvučení.
Všechny testy používaly syntetický WAV; skutečná hudba, fyzické ozvučení ani cloud
nebyly součástí tohoto ověření. Nasazení neproběhlo.
