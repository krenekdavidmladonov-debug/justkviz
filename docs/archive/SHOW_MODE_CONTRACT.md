# Show Mode — schválený a lokálně implementovaný kontrakt

Stav: vlastník schválil všechny tři povinné obrazovky společného směru
(mezivýsledky, běžné finální umístění a vítězové) a následnou plnou lokální
implementaci včetně audia, synchronizace a testů. Nejde o výběr alternativ.
Implementační větev je `codex/show-mode-implementation`, základ `9404e1c`.
Původní návrhové odkazy na řádky níže popisují výchozí stav `be81596`;
aktuální zdroj a ověření shrnuje [SHOW_MODE_IMPLEMENTATION.md](SHOW_MODE_IMPLEMENTATION.md).
Souhlas s lokální implementací **není souhlas s deploymentem ani cloudovým
čtením/zápisem**. Návrhové formulace dále vyjadřují schválený kontrakt.

## Co už existuje a musí zůstat jedinou autoritou

| Oblast | Konkrétní zdroj | Důsledek pro návrh |
| --- | --- | --- |
| Výpočet výsledků | `functions/src/leaderboard/model.ts:27`, `:75` | Použít existující půlbody, úplnost a dense pořadí. Nevytvářet další skóre ani pořadí. |
| Potvrzení mezivýsledků | `functions/src/leaderboard/callables.ts:86`, `:99` | Zachovat náhled, fingerprint, přesnou revizi, immutable `interimVersions` a receipt. Dnešní klasické stránky mají osm řádků; nový Show Mode používá serverové pageSize 6 podle kontraktu níže. |
| Finále | `functions/src/final-reveal/callables.ts:12`, `:23`; `functions/src/final-reveal/model.ts:6` | Zachovat `finalVersions`, bottom-up skupiny shod, start/replace, explicitní table a ruční END. |
| Veřejná publikace | `functions/src/live/publication.ts:153`; `apps/web/src/features/live/liveMappers.ts:169` | Celý veřejný dokument stavět allowlistem; renderer ani skrytá větev nesmějí dostat budoucí týmy či neodhalené odpovědi. |
| Oprávnění | `functions/src/access/authorization.ts:23`, `:69`, `:108`, `:125`, `:137` | Aktuální Auth, aktivní membership, konkrétní permission a event scope; opakovat uvnitř transakce. Role v názvu ani legacy claims nestačí. |
| Zamčený vzhled | `functions/src/events/snapshot-model.ts:18`; `functions/src/live/publication.ts:16`; `packages/quiz-domain/src/design.ts:59` | Vzhled výsledků dědí snapshot defaultDesign → příslušný resultTemplate. Pozdější knihovní editace nesmí změnit večer. |
| Lokální přehrávání | `apps/web/src/features/live/LiveModeratorView.tsx:89`, `:194`; `apps/web/src/features/presentation/MediaPlayer.tsx:9` | Běžné audio již hraje u moderátora. Show audio má použít stejný skutečný výstup a společný rozpočet jednoho přehrávače. |

Starší text v `INTERIM_RESULTS.md`/`FINAL_REVEAL.md` hovoří o staff claim/roli.
Současná autorita je výše uvedený membership wrapper; nový kód se musí řídit jím.

## Mezivýsledky jako překryv a přesný návrat

Dnes publish i hide zavolají `go-to-slide` na stejné pozici
(`functions/src/leaderboard/callables.ts:139`, `:158`). Ten ruší reveal/recap
a zvyšuje mediaGeneration (`functions/src/live/session-machine.ts:61`).
Projektor výsledky zobrazí místo slidu (`apps/web/src/routes/projector/ProjectorPage.tsx:36`).
Pouhé CSS překrytí stávajícího výsledku proto nestačí k návratu „přesně tam,
kde moderátor skončil“.

Navržené chování:

1. Při prvním publish server v téže transakci uloží do private session
   `interimReturn`: `{ snapshotId, slideId, slidePosition, presentationMode,
   answerRevealed, recapQuestionId?, recapQuestionPosition?, capturedRevision }`.
   Pole pocházejí výhradně z právě potvrzené session. Neobsahují odpověď,
   obsah slidu, URL, play command ani klientské reveal flags. Vazba zahrnuje
   existující event/session/snapshot. Practice session tuto funkci nedostane.
2. Změna stránky ani nahrazení potvrzené interim verze původní return intent
   nepřepíší. Přechod do finále, END/cancel/archive jej odstraní.
3. Publish okamžitě zastaví otázkové audio/video, zvýší mediaGeneration,
   nastaví idle a zruší staré callbacky. Nový `interimBackdrop` je statický,
   serverem odvozený běžný slide stejné pozice, nad ním ztmavení a výsledky.
   Jeho uzavřený typ obsahuje jen renderMode, slideKind, title, text, options,
   round/question metadata, bezpečný design, backgroundImage a questionImage.
   Neobsahuje answerDesign, answerImage, revealedAnswer, answerExplanation,
   recap selection, audio/video zdroje, media pole ani přehrávač. Při vstupu
   nad odpovědí je v pozadí běžná otázka; nad recapem jeho běžná hlavička.
4. Hide zahodí překryv a z autoritativního stejného immutable snapshotu znovu
   vytvoří původní pozici **včetně dříve explicitně odhalené odpovědi nebo
   zvolené recap otázky**. Nová session revision je očekávaná aktuální revize;
   capturedRevision není požadavek rovnosti po stránkování. Server ověří
   nezměněnou vazbu, existenci slidu a příslušnost recap otázky ke stejnému kolu.
   Obnovení answer režimu vyžaduje i současné `event.answers.read`.
   Původní explicitní reveal je uložený serverový intent, nikoli nové klientské
   tvrzení. Odpověď se znovu čte a publikuje pouze přes existující allowlist.
5. Hudba a otázkové médium se nikdy automaticky neobnoví: idle, nová generace,
   ruční Play/Replay. Původní přehrávací čas se neukládá. Návrat zachovává
   prezentační obsah a výběr, nikoli živý dekodér nebo zvuk.
6. Revokace answer permission dovolí s `event.live` překryv skrýt, ale návrat
   proběhne na stejný běžný slide bez odpovědi a UI vysvětlí omezení.
   Neplatná vazba nebo uzavřená akce nesmí obnovit starou odpověď; použije se
   aktuální bezpečný lifecycle výstup. Tato bezpečnostní výjimka má přednost
   před přesným návratem. Nedostupný serverový hide nic lokálně nepublikuje.

Jde o úzkou změnu lifecycle, ne o opětovné použití resetujícího go-to-slide pro
obnovení odpovědi. Obyčejná navigace zůstává při překryvu zablokovaná do hide.
Veřejný backdrop je odvozen v publish transakci; projektor jej nesmí sestavovat
z vlastní staré cache. HTTP gateway musí nově uznat pouze image reference
v **aktuálním** `interimBackdrop`, včetně kontroly po IO; dnešní
`functions/src/media/model.ts:33` po výsledkovém payloadu odmítá ostatní obrazová
pole. Rozšíření není obecným čtením médií ze snapshotu.

## Finále a zveřejnění po skupinách

Stávající `revealRanks` a `advanceFinal` (`functions/src/final-reveal/model.ts:6`,
`:13`) již odhalují od nejnižšího dense umístění. Příklad 1/2/2/3 znamená
3 → oba druzí → vítěz. Řazení názvem uvnitř shody remízu nerozhoduje.

Navrhujeme zachovat ruční další umístění a přidat explicitní
**Odhalit nižší umístění najednou**. Server sám vybere všechny skupiny s rank > 3;
nikdy nepřijme klientský seznam, rank ani počet odhalení. Příkaz funguje pouze
na úvodu nové potvrzené verze. Pokud nejsou nižší skupiny, není dostupný.
Po bulk kroku pokračuje 3 → 2 → 1, pouze existující skupiny, každá samostatně.
Jedna či dvě skupiny a všichni na prvním místě fungují bez prázdných kroků.

Minimální rozšíření shared `FinalRevealPage.mode` a private pointeru je `lower`.
V něm `rank = null`, `groupSize = 0`, page/pageCount patří jen již zveřejněným
rank > 3 a revealedCount odpovídá počtu těchto skupin. Show stránka má nejvýše
šest řádků; pro show je lze seřadit od nejnižšího umístění. Následující reveal užije
existující pořadí skupin. Plná table nadále vyžaduje revealedCount = totalGroups.
`controlFinalReveal` dostane akci `reveal-lower`; command fingerprint a receipt
ji zahrnou stejně jako dnešní příkazy. Start/replace zůstane prázdným úvodem.

Všem veřejným klientům přijde jen právě explicitně povolená stránka. Lokální
stagger animace bulk stránky je dekorace nad již zveřejněnými řádky; nesmí
přednačíst další stránky ani top 3. Shoda přes více stránek je jedna skupina,
`groupSize` určuje „Vítězné týmy“. Vítězná cue má jeden pokus pro odhalení
rank 1, nikoli pro každou stránku/tým. Není zaveden dodatečný rozstřel.

## Jediný kontrakt stránkování a kompatibilita

**Show Mode má pageSize = 6, klasický režim pageSize = 8.** Klient nesmí
oříznout osm serverových řádků na šest: ztratil by týmy mezi stránkami.
Stejná velikost platí pro mezivýsledky, finální lower/group/table i věrný náhled.
Soukromý pracovní náhled se také stránkuje podle zvoleného režimu, nezávisle
na právě zveřejněné stránce.

`controlInterimResults` publish a `controlFinalReveal` start/replace přijmou
volitelný enum `presentationStyle: 'classic' | 'show'`; nepřítomnost znamená
classic. Server z něj odvodí pageSize, zahrne styl do command fingerprintu
a uloží `presentationStyle` a `pageSize` do nové immutable výsledkové verze
a private session pointeru. Veřejný show payload nese explicitní show/6;
veřejný classic payload obě pole vynechá a nadále znamená classic/8, aby jej
mohl číst i starý striktní projektor. Výpočet skóre
a sourceFingerprint tím nejsou změněny. Klient nemůže poslat libovolné číslo.

Při čtení všech starých verzí, pointerů a payloadů je chybějící pageSize vždy
8 a chybějící styl classic. Explicitní dvojice smí být pouze classic/8 nebo
show/6; nekonzistentní či jiná hodnota selže uzavřeně. Serverový model,
public parser, moderator preview a ResultsTable/FinalRevealView používají
tentýž shared normalizátor. Server odvodí pageCount, povolené page a slice
podle velikosti uložené verze; klient používá tutéž hodnotu pro indexy a popisky.

Styl a velikost zůstávají během dané potvrzené verze pevné. Page, hide/resume,
static, reconnect ani dokončení odhalování je nepřepínají. Přechod staré
potvrzené classic verze do Show Mode vyžaduje explicitní nový publish nebo
start/replace po kontrole náhledu; žádná tichá konverze pokračujícího finále.
Historické verze se nepřepisují ani nemigrují. Jejich staré stránky zůstanou
osmiřádkové. UI Show Mode odesílá show výslovně; klasické staré požadavky dál
vytvoří classic verzi. Nový veřejný payload se šesti řádky se smí publikovat až po
společné integraci serveru a nových parserů/rendererů; otevřený starý web není
považován za podporovaného Show Mode klienta a před akcí vyžaduje refresh.

## Autorita, animace a okamžité ovládání

Výsledkové řádky, verze, skupina, stránka, viditelnost a END zůstávají serverové.
Čas dokončení animace, třpyt, pohyb a zvukový stav jsou místní prezentace.
Dokončení animace ani skladby nesmí odhalit další tým nebo ukončit session.

K aktuální výsledkové publikaci přibude volitelné
`showCue: { id, kind, motion, startedAt, durationMs }`.
`id` a čas vytvoří server; `kind` je bounded enum `interim | lower | third |
second | winners | final-intro | reveal`, `motion` je `animate | static` a durationMs je
validovaný krátký limit konkrétního návrhu. ID odkazuje na prezentační krok,
nikoli na tým. Cue dále nese pouze vizuální `intensity: none | subtle | show`,
`topThree` a `winnerAnimation`; neobsahuje audio reference. Při stránkování se zvuk nespouští.
Animation settings jednoho již publikovaného kroku se zpětně nemění úpravou
event defaults.

**Přeskočit animaci** je revisioned akce `static` příslušného existujícího
control callable: stejné řádky/verze/skupina, motion static, nová revision,
receipt; bez dalšího odhalení. **Zobrazit bez animace** zvolí static již při
publikaci. **Skrýt** použije skutečný serverový hide; STOP zvuku je místní
a funguje okamžitě i při pending požadavku. Tyto únikové akce nesmějí čekat na
CSS animationend. Klient ignoruje opožděné completion callbacky po změně cue ID.
`prefers-reduced-motion` může vždy lokálně omezit pohyb. Náhled zobrazuje tentýž
veřejný payload; nesmí mít vlastní výsledkovou pravdu.

Při prvním načtení, reconnectu, restartu komponenty nebo prošlé durationMs se
aktuální krok zobrazí staticky. Animovat může pouze nově přijatý serverový krok
v již živém odběru a platném časovém okně. Neděláme synchronizaci na frame;
dva projektory mohou mít různou drobnou latenci. Moderátor rozlišuje
„animace místního náhledu“ a „stav projektoru nepotvrzen“; samotný časovač ani
BroadcastChannel nejsou důkazem dokončení na vzdáleném projektoru.

Zůstávají ochrany `liveRepository.ts:43` a
`ProjectorPage.tsx:86`: odmítnout cache-only/cizí/starší stav, vyčistit obraz
na offline/error, invalidovat callbacky, při reconnectu nejprve server read.
BroadcastChannel nepřenáší autoritativní show příkazy. Nezavádět durable cache
hudby ani odpovědí. Výpadek nemusí být rozpoznán okamžitě a doručený údaj už
nelze vzít divákovi zpět.

## Jediný pracovní blok moderátora

`LiveControlPage.tsx:262` dnes připojuje InterimResultsPanel a FinalRevealPanel
pod hlavní LiveModeratorView. Show Mode je má uspořádat do jednoho bloku u
aktuálního náhledu a hlavní navigace, s jednou společnou frontou mutací.
Současná fronta v `LiveControlPage.tsx:156` nezahrnuje samostatné výsledkové
panely; UI sloučení bez sjednocení pending/revision řízení by dál závodilo.

Blok ukazuje současně: **co je na projektoru**, potvrzenou verzi a stránku,
rozsah zveřejněných kol/skupin, rozdíl soukromého náhledu od publikace,
**další krok** (např. „Odhalit oba týmy na 2. místě“), pohyb místního náhledu,
stav spojení a připravenost hudby. Soukromý náhled budoucích týmů je zřetelně
oddělený od věrného veřejného náhledu. Čekající nebo neúplné skóre blokuje
potvrzení, nikoli STOP. Aktualizace výsledků stále vyžaduje explicitní potvrzení
nové verze, nahrazení finále výslovný nový začátek.

Hlavní akce je jen akce platná pro aktuální režim. Vždy dostupné místní
STOP, poté příslušné serverové Přeskočit / Skrýt a ruční END. Běžné Play
otázky je při výsledcích zablokované; otázkové i show akce mají společný busy
a čerstvou potvrzenou revision. UI chybu zvuku nezaměňuje s chybou zveřejnění.

## Výchozí nastavení akce a pět vlastních zvuků

Navržené privátní `events/{eventId}.showPreferences`:

```ts
{
  schemaVersion: 1,
  motion: 'none' | 'subtle' | 'show',
  lowerRanks: 'step' | 'bulk',
  topThree: boolean, winnerAnimation: boolean, audioEnabled: boolean,
  volume: number, fadeInMs: number, fadeOutMs: number,
  cues: { intro?: string, interim?: string, suspense?: string,
          reveal?: string, winner?: string }
}
```

Pět slotů znamená intro, mezivýsledky, napětí, odhalení a vítěznou skladbu.
Nejde o samostatné skladby pro třetí/druhé místo. Výchozí nastavení je subtle,
step, topThree true, winnerAnimation true, audioEnabled false, volume 0,25,
fade-in 300 ms a fade-out 500 ms; volume je 0..1 a obě fade hodnoty 0..2000 ms.
Finální úvod je bez přiřazené a povolené skladby tichý. Zdroj je pouze existující ready vlastněný
`quiz-asset:` s kind audio, MP3/WAV, validní generation, MIME/size/signature;
stejný soubor lze vybrat vícekrát. Žádný výchozí soubor nepředstíráme jako
nahraný/připravený. Prázdný slot je platný tichý režim. Vzhled zůstává děděný
z immutable snapshotu; tento objekt nepřepisuje quiz/round/answer design ani
nevytváří druhé výsledkové šablony. Defaults jsou per event, nikoli globální
localStorage, a neovlivňují již potvrzené výsledkové řádky.

Navržený nový `configureEventShow({ eventId, expectedRevision, preferences })`
použije event revision, serverovou validaci a transakci jako updateEvent.
Vyžaduje `event.live` + scope a operational event; připojení nové audio
reference navíc vyžaduje aktuální `quiz.read` + scope zdrojového kvízu a ověřenou
viditelnost assetu: veřejná otázková role v privátním zdroji, vlastní upload
s `quiz.media.upload`, nebo `quiz.answers.read`; privátní answer role vždy
vyžaduje `quiz.answers.read`. Již schválené sloty
může event-only moderátor používat a měnit jejich hlasitost/pohyb bez čtení
celé knihovny. Nový upload používá pouze existující grant protocol s odděleným
`quiz.media.upload`; `event.live` upload právo nenahrazuje. Kdo knihovnu nemůže
číst, uvidí připravené sloty akce a požadavek na oprávněné doplnění. Preferences
se nikdy nekopírují do publicEvents/publicSessions. Nezavádět novou kolekci.

**Skutečná mezera přístupu:** dnešní `authorizePrivateMedia`
(`functions/src/access/media.ts:8`) v snapshot kontextu vyžaduje připojení
reference do immutable snapshotu; show-only skladbu nahranou později odmítne.
Picker `mediaApi.ts:8` také prochází privátní quiz oprávnění a redakci
(`functions/src/access/reads.ts:89`). Samotný event.read není univerzální
čtení libovolného quiz assetu a starý snapshot se kvůli zvuku nesmí přepsat.

Implementace obsahuje úzké rozšíření autentizovaného `readQuizMedia` o vzájemně
výlučný `eventId` kontext: fresh Auth, aktuální `event.live` + event scope,
operational event a **přesná reference v právě uložených showPreferences.cues**.
Privátní `showAudioBindings` navíc připíná reference a generation konkrétního
ověřeného assetu; jeho MIME a velikost se kontrolují při přiřazení i čtení.
Pouhý řetězec v cue není dostatečným audio grantem.
Read zkontroluje ready audio a pinned generation a po IO znovu membership,
event a připojení reference. Je to eventem přidělený zvukový přístup, ne grant
na zdrojový kvíz ani anonymní audio. Odebrání slotu/revokace ukončí nový read;
lokální odběr změny nastavení zruší načítání a přehrávání starého slotu.
Již stažené bajty nelze zpětně odebrat. Současná veřejná session větev gateway
zůstane jen pro aktuálně publikované obrazy/explicitní recap audio.

Hudba se doporučuje přehrávat **na zařízení moderátora**, ze stejného fyzického
audio výstupu jako dosavadní otázky. Projektor a náhled druhý show player
nedostanou; vzdálené řízení zvuku by vyžadovalo další player lifecycle protokol
a není součástí tohoto minimálního návrhu. Reálné směrování HDMI/reproduktory
ověří provozovatel poslechem, web jej nemůže potvrdit.

Každý slot má výběr souboru z vlastněných médií, **Poslechnout**, volume,
fade-in/out a **STOP**. Poslechnout skutečně načte/dekóduje soubor a spustí ho
po přímém kliknutí; samotný výběr/metadata se nesmějí hlásit jako otestovaný
zvuk. UI rozliší nevybráno, načítání, připraveno po dekódování, autoplay
blokováno, hraje po skutečné události playing, dohrálo a chyba.
Neúspěšný play vyžaduje nové ruční gesto, nezablokuje show příkaz.

Jediný lokální audio koordinátor vlastní otázkové audio, show audio i dosavadní
syntetickou fanfáru (`features/final-reveal/fanfare.ts`). Poslech ani cue nesmí
hrát přes otázku; nejprve potvrzené stop/idle a nová mediaGeneration, potom
jeden hráč. Přechod zpět k otázce zastaví show zvuk, vynuluje místní epochu
a vyžaduje ruční Play. Žádné mixování, skryté YouTube okno, YouTube pro show
hudbu, auto loop nebo pozdě spuštěná skladba po síťovém čekání. Místní STOP
přeruší i fade a asynchronní decode. Blob URL jsou jen v paměti, s abort/revoke
na změně, odchodu, ztrátě přístupu či spojení.

Pro vzdálené VIDEO platí dodatečný limit: serverové idle ani nová generation
nejsou potvrzením, že projektor již zpracoval snapshot a fyzicky přestal hrát.
Dnešní BroadcastChannel není síťový transport mezi různými zařízeními.
Minimální varianta proto při přechodu z aktivního VIDEO automatickou show cue
nespustí; po zastavení a ověření projektoru ji moderátor pustí ručně. Pro
garantované automatické předání mezi zařízeními by bylo nutné navrhnout
ověřený stop-ack protokol aktuálního playeru, jeho timeout a více projektorů.
Takový protokol tento návrh nepředstírá. U lokálního otázkového AUDIO vynucuje
vzájemné vyloučení přímo společný koordinátor.

Automatický zvuk smí iniciovat pouze panel, který právě provedl čerstvý úspěšný
non-replayed serverový krok, předem získal uživatelské gesto, má připravenou
cue a samostatným aktuálním serverovým čtením ověřil přesnou verzi/revizi,
viditelnost a cue ID. Zachovat princip `FinalRevealPanel.tsx:69`.
Reload, snapshot, reconnect, page, resume, retry, druhý panel a pozdě dokončené
načtení nikdy nespustí zvuk. Lokální epoch/STOP platí i po await resume/decode.
Načítá-li se hudba příliš dlouho, show pokračuje tiše a nabízí ruční spuštění.
Přesně jednou slyšitelný výstup nelze garantovat při ztrátě potvrzení nebo
poruše zařízení; garantovat lze nevydávání replay oprávnění z receipt.

## Přesný budoucí zásah a ověření

| Soubor / export | Plánovaný rozsah po schválení |
| --- | --- |
| `packages/quiz-domain/src/final-reveal.ts`, nový úzký shared show typ | `lower`, bounded cue/preference/backdrop typy a společná normalizace classic/8 versus show/6 s legacy defaultem 8; žádná alternativní kalkulace výsledků. |
| `functions/src/leaderboard/callables.ts` / `controlInterimResults` | Capture/restore návratu, statický sanitized backdrop, static akce, zachovat fingerprint/verze/receipt. |
| `functions/src/final-reveal/model.ts`, `callables.ts` / `controlFinalReveal` | `reveal-lower`, static akce, cue vytvořená serverem, stránkování podle pageSize uložené verze; zachovat celistvost skupiny shody a table guard. |
| `functions/src/live/types.ts`, `callables.ts`, `session-machine.ts`, `publication.ts`, `event-lifecycle.ts` | Parse/clear return/cue, úzký bezpečný restore, whole-document allowlist a END/cancel/archive cleanup. Zahrnuje všechny stávající live mutation/report exports. |
| `functions/src/events/types.ts`, `validation.ts`, `model.ts`, `callables.ts`; `functions/src/index.ts` | Privátní preferences + nový `configureEventShow`; žádný zásah do immutable otázek/snapshotů, žádné publikování prefs veřejné akci. |
| `functions/src/access/authorization.ts`, `reads.ts`, `media.ts`; `functions/src/media/endpoint.ts`, `model.ts` | Konkrétní policy configure, privátní event read allowlist, přesný event-audio kontext a image allowlist backdropu. |
| `apps/web/src/routes/admin/LiveControlPage.tsx`, `features/live/LiveModeratorView.tsx`, `liveApi.ts`, `types.ts`, `liveMappers.ts`, `projectorChannel.ts` | Integrovaný blok, jediná fronta, runtime validace nových payloadů, stále pouze Firestore presentation authority. |
| `features/leaderboard/InterimResultsPanel.tsx`, `ResultsTable.tsx`; `features/final-reveal/FinalRevealPanel.tsx`, `FinalRevealView.tsx`, CSS; `features/presentation/ResultBackdrop.tsx` | Sdílené ovládání a skutečný veřejný náhled, overlay, lower/podium layout, skip/static a reduced motion. |
| `apps/web/src/routes/projector/ProjectorPage.tsx`; `features/media/mediaApi.ts`; nový malý lokální ShowAudioCoordinator | Statický sanitized background a místní cue lifecycle; pouze autentizovaný event-audio fetch u moderátora. |

Rules nezačnou dovolovat nové zápisy nebo veřejné čtení privátních dat.
Případnou úpravu pravidel lze určit až při implementaci konkrétních polí;
`pnpm check` a `pnpm test:rules` jsou povinné pro boundary změny. Doplnit
doménové, izolované demo-emulator a browser kontrakty: přesný návrat question /
revealed answer / recap, zrušené oprávnění a neplatná vazba, stale receipt,
bulk bez top3 v anonymní síti, dense tie přes >6 show týmů i >8 legacy týmů,
jeden/všichni vítězové, legacy potvrzené verze/pointery bez pageSize,
pageCount/slice při 6/7/8/9/12/13 týmech bez vynechání či duplikace,
neplatné kombinace stylu/velikosti a pokračování starého classic finále,
static/hide během animace/decode, offline/reconnect bez zvuku, dva panely,
společný limit playerů a event-only media access včetně odebrání slotu během IO.
Ověřit anonymní payloady i skutečné HTTP bajty, ne pouze DOM/screenshot.

Lokální implementace a testy jsou rozpracované/ověřované podle evidence
v SHOW_MODE_IMPLEMENTATION.md. Neproběhl deploy, cloudové čtení/zápis ani
poslech na fyzickém výstupu. Budoucí samostatně schválené nasazení musí určit
konkrétní zdrojovou verzi a celý inventář změněných exportů, včetně starých
callables s novým parserem/lifecycle; lokální manifest tento souhlas neuděluje.
