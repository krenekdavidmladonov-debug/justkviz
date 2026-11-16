# Show Mode — lokální implementace

Vlastník schválil všechny tři povinné obrazovky společného směru a lokální
implementaci. Tato práce nezahrnuje deploy ani cloudové ověřování.

## Důvěryhodný server a shared protokol

`packages/quiz-domain/src/show-mode.ts` definuje strict preference, veřejný cue,
statický backdrop a společnou normalizaci stránkování. `show` má šest řádků,
`classic` osm; chybějící metadata starých verzí/pointerů/payloadů znamenají
classic/8. Výslovně neslučitelná metadata včetně null selžou uzavřeně.
Nové privátní potvrzené verze/pointery ukládají styl i velikost; veřejné show
payloady je posílají explicitně, veřejné classic payloady obě pole vynechávají
pro staré striktní projektory (nadále default classic/8). Server podle stejné hodnoty
počítá slice i pageCount. Historické dokumenty se nepřepisují a během verze
nelze změnit velikost pouhou změnou stránky.

`controlInterimResults` přijímá `presentationStyle` a volitelné `motion`
(`animate | static`) pouze při publish. Přibyla revisioned akce `static`.
První show publish zachytí private `interimReturn`, při změně stránky nebo
nahrazení tabulky jej nepřepíše. Obsahuje jen serverové pozice/ID, snapshot,
režim a stav předchozího explicitního reveal, nikoli odpověď nebo playback.
Veřejný `interimBackdrop` je znovu odvozený statický běžný slide bez answer
designu, odpovědi, answer image nebo audio/video source; není klientskou cache.

Hide znovu načte aktuálně navázaný immutable snapshot a obnoví původní explicitní
reveal/recap selection. Obnovení odpovědi vyžaduje současné `event.answers.read`
z membership přečteného v transakci. Chybějící/neplatná původní otázka, jiný
snapshot/kolo nebo odebrané answer oprávnění vrátí bezpečnou otázku/hlavičku;
response uvádí `returnRestored: false`. Ztráta event.live nebo uzavřená akce
nedovolí samotnou mutaci. Média jsou po vstupu i návratu idle s novou generation.

Potvrzené nové interim verze uchovávají privátní `rowTeamIds` a `teamRanks`.
Soukromý `lastInterimVersionId` zachová odkaz i po hide. Pohyb pořadím se počítá
jen proti předchozí skutečně publikované verzi stejného event/session/snapshot
a podle stabilních ID. Veřejně přichází pouze číselné movement u řádku;
přejmenování ani shoda názvů neurčují identitu. Staré verze bez stabilní mapy
neposkytují domyšlené šipky a neporovnává se proti právě rozepsaným skóre.

`controlFinalReveal` přidává `reveal-lower`, `history-page` a `static`.
Hromadný krok funguje jen z show intro s dosud nulovým odhalením a zveřejní
rank > 3. Následují existující dense skupiny 3 → 2 → 1, vždy ručně. Neexistující
skupiny nevytvářejí prázdné kroky. Všichni vítězové jsou jedna skupina, její
velikost není omezena šesti; právě zobrazená stránka je. `page` stránkuje
aktuální skupinu nebo lower/table, `history-page` se stejným parametrem page
nezávisle stránkuje dříve odhalené skupiny. History se publikuje pouze v show
group a má nejvýše šest řádků, výhradně rank > právě odhalený rank. Intro,
lower a table history neobsahují. Table stále vyžaduje úplné odhalení.

Start/replace a reveal/reveal-lower přijímají volitelné motion. Jen start/replace
přijímá styl. Hide/resume zachovává potvrzenou verzi a postup. Start/replace,
END a event closure odstraní starý interim return intent. Uživatelské ukončení
zůstává explicitní; žádný časovač nebo audio completion neodhaluje další týmy.

Veřejný `showCue` obsahuje serverové SHA-256 operation ID, typ kroku, epoch ms,
krátkou bounded duration, animate/static a pouze vizuální nastavení
intensity/topThree/winnerAnimation. Nevystavuje audio reference ani privátní
preferences. Motion none, zakázané podium/winner efekty nebo explicitní static
vytvoří statický cue. Page/history-page/resume/static vždy vytvoří nový statický
cue. Cue existuje pouze při viditelných show výsledcích, nikdy na běžném slidu.

Všechny mutace nadále používají aktuální Auth, aktivní membership, konkrétní
permission a event scope v `securedOnCall`/`runAccessTransaction`, přesnou
session revision a existující event/session/snapshot binding. Nová pole příkazu
vstupují do operation fingerprintu; staré požadavky si zachovávají původní hash.
Dokončený retry nevykoná zápis, nepřidá odhalení ani nevrátí showCue pro zvuk;
vrací `replayed: true` (finále také winnerRevealed false). Nový úspěch vrací
`replayed: false`. Celý veřejný dokument se stále nahrazuje atomicky.

Serverová implementace nerozšiřuje veřejná Firestore oprávnění. Gateway média,
konfigurace akce a lokální audio mají vlastní úzké ověření. Firestore zůstává
jedinou autoritou výsledků a odpovědí; BroadcastChannel nemůže nic zveřejnit.

## Backend ověření

`tests/showModeDomain.test.ts` ověřuje legacy default, neplatné kombinace,
6/7/8/9/12/13 spoluvítězů bez vynechání nebo duplicity, lower → podium,
bounded historii, zakázanou předčasnou table a strict cue/preference/backdrop
allowlisty. `tests/showModeServer.test.ts` ověřuje návrat odpovědi/recapu,
permission/snapshot/kolo fail-closed, nulový playback, odstranění intent při
END, preference efektů a pohyb podle stabilních ID včetně stejných názvů.

Dokončené centrální ověření na Node 22: celý `pnpm check` PASS, 603 unit testů
v 60 souborech PASS a všech 50 Firestore Rules testů PASS. Skutečný Show Mode
emulatorový scénář prošel sedmi skupinami v
`.local-data/show-mode-implementation/browser-integration-2.log`; zahrnuje
anonymní payloady, přesný návrat, šestřádkové remízy, lower/history, legacy osm
a aktuální oprávnění. Předchozí centrální běh
`browser-integration-1.log` dokládá 21 audio kontraktů, 12 původních interim
skupin a osm původních final skupin. Nejde pouze o mockované SDK testy.

Historicky první dílčí worker pokus Vitest skončil před importem testů na
sandboxovém TEMP rename EPERM. Opakování se zapisovatelným TEMP pod ignorovaným
`.local-data/show-mode-implementation/temp` tehdy prošlo 51 testy v pěti sadách.
Tyto dílčí pokusy byly před dokončením implementace; nejsou finální evidencí.
Pozdější centrální Node 22 kontroly výše je nahrazují jako release gate.
Historické neúspěšné browser/QA pokusy zůstávají oddělené v lokálních logách
a nevydávají se za passing evidence. Aktuální integrované browser výsledky,
vizuální opravy, srovnávací měření a přesnou zdrojovou verzi uvádí
[SHOW_MODE_RELEASE.md](SHOW_MODE_RELEASE.md).

## Moderátorská integrace a projektor

SHOW MODE je součástí původní stránky živého moderování. Ovladače výsledků,
finále a běžných slidů používají jednu frontu mutací a potvrzenou revizi session.
Soukromý náhled zůstává oddělený od zveřejnění. Publikuje se pouze výslovně
zkontrolovaná verze; změněné body vyžadují nový náhled a potvrzení nahrazení.
Styl nové verze lze zvolit před zveřejněním nebo po skrytí předchozího finále.
Aktuální viditelná verze se tím nepřepočítává ani nepřestyluje.

Společný ShowModeRenderer vykresluje stejný veřejný stav v náhledu moderátora
i na projektoru. Klasické výsledky používají původní renderer. Show přebírá
stávající fonty, barvy, logo a bezpečnou výsledkovou šablonu; nepřidává knihovnu
animací. CSS používá transform/opacity. Krátký serverový cue není časovačem
výsledků: nikdy sám neodhalí další místo. První snapshot, reload, reconnect,
stránkování a resume zobrazí stabilní stav bez opakování efektu. Reduced motion
a příkaz „Přeskočit animaci / statický obraz“ efekty ruší. Význam přepínače
TOP 3 je v UI přesně „Animace 2. a 3. místa“; vítězové mají vlastní přepínač.

Ve finále lze stránkovat právě odhalenou skupinu i předchozí pořadí. Více
vítězů zůstává jedním společným prvním místem se stejným skóre; přes šest týmů
má další stránky. Veřejný klient nikdy nečte soukromý úplný žebříček pro animaci.
Ovládání uvádí, co publikum podle potvrzeného stavu vidí, jaká verze je veřejná,
co následuje a zda byl vydán animační pokyn. Nezaměňuje jej za potvrzení fyzického
vzdáleného zobrazení nebo dokončení animace.

Audio je lokální výstup moderátora, s pěti soubory a samostatným STOP.
Automatický start vyžaduje původní uživatelské gesto, nereplayované potvrzení,
čerstvý serverový read přesné session/revize/verze/cue a nejvýše tři sekundy
od kliknutí. Stejná kontrola platí i po downloadu a dekódování. Zmeškané okno
ponechá možnost nového ručního přehrání. Přehrávání otázky a jeho připravovaný
příkaz mají přednost; zneplatnění se váže na konkrétní mediaGeneration, takže
platí i po zásahu jiného panelu. Podrobnosti a omezení jsou v
[SHOW_MODE_AUDIO.md](SHOW_MODE_AUDIO.md).

## Reprodukce a rozsah vydání

Po běžném buildu použít Node 22, lokální emulátory Auth/Firestore/Functions/Storage
s demo projektem a explicitním loopback FIREBASE_STORAGE_EMULATOR_HOST. Spouštěče
`pnpm test:e2e:show-mode`, `pnpm test:e2e:show-audio` a
`pnpm test:e2e:show-browser` vyžadují tyto emulátory; fixture selžou uzavřeně při
chybějícím lokálním prostředí. Browser používá produkční demo preview na 5208.
`pnpm check` a `pnpm test:rules` zůstávají povinné kontroly před commitem.

[Manifest vydání](../tools/show-mode/deployment-manifest.json) eviduje 28 Functions
včetně dvou nových a Hosting. Nemění Rules, indexy ani secrets; nevyžaduje migraci.
Je to inventář připraveného rozsahu, nikoli povolení deploye. Cloudové schválení
je false a projekt zůstává null. Pro závěrečné výsledky testů, verzi, screenshoty
a skutečné měření viz [předání implementace](SHOW_MODE_RELEASE.md).

## Hraniční kapacita a skutečný frontend baseline

Doménové kontrakty navíc projdou 1 000 spoluvítězů přes všech 167 šestřádkových
stránek bez duplicit/ztráty a 1 000 dense umístění přes všech 167 lower i 167
history stránek bez budoucího podia. Limit 1 001 týmů je odmítnut stávajícím
výpočtem. Při maximálních 80 UTF-16 jednotkách názvu a kanonických 64znakových
ID zůstává testovaný privátní výsledkový JSON pod 512 KiB a každá veřejná
výsledková stránka pod 8 KiB. Jde o aplikační JSON, nikoli přesný odhad
Firestore wire encoding nebo velikosti libovolného slidu/backdropu. CPU-only
regresní test má velkorysý limit dvou sekund; není síťovým benchmarkem.

`tools/qa/show-mode-baseline.mjs` provede read-only git archive původního
`9404e1c5e96b085af875c0eefb641247a6388c0e` webu a quiz-domain do ignorovaného
`.local-data/show-mode-baseline`, sestaví jej současnými lokálními závislostmi
a výslovným aliasem na **archivovaný** quiz-domain. Vyžaduje Node 22, demo env,
nic neinstaluje a nemění checkout. Volba `--serve` spustí produkční preview
na loopback 5209. Pro comparison používá `show-mode-baseline.config.ts`
aktuální produkční web na 5208 a archivovaný na 5209, stejné syntetické týmy
a současný lokální backend. Čtyři střídavá měření po zahřátí sledují Next a
klasickou publikaci při šestinásobném CPU throttlingu projektoru, skutečný
fetch→DOM čas, RAF mezery a Long Tasks. Je to skutečné porovnání frontend
zdrojů před/po, **nikoli reprodukce historického backendu**; výsledky jsou až
v generovaném `evidence/before-after.json`, ne odvozené z předpokladů.
