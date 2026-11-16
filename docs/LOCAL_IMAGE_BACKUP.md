# Místní záloha obrázků uzamčeného kvízu

Etapa 3 rozšiřuje místní demo provoz o jeden soubor `.justkvizbackup` s vlastními statickými PNG, JPEG a WebP. Obsah vychází z aktuálního neměnného snapshotu akce. Firebase potvrzuje navigaci, zveřejnění odpovědí, relace i bodování. Místní soubor dodává jen bajty právě povoleného obrázku.

| Omezení | Hodnota |
| --- | --- |
| Unikátní obrázky | Nejvýše 64, opakované bezpečné použití sdílí stejné bajty |
| Jeden obrázek | Nejvýše 10 MiB |
| Součet obrazových dat | Nejvýše 64 MiB |
| Hlavička souboru | Nejvýše 256 KiB a 28 bajtů značky formátu s délkou; celý soubor nejvýše 67 371 036 B |
| Vazby obrázků | Nejvýše 1 600 použití v indexu; opakované pozadí či logo se počítá na každém snímku |
| Rozměry obrázku | Nejvýše 8 388 608 pixelů a 8 192 pixelů na každé ose |
| Současné místní zobrazení | Nejvýše čtyři role a celkem 16 777 216 pixelů, počítají se jednotlivá použití |
| Příprava a kontrola souboru | Sekvenční stažení, hashování a dekódování jednotlivých obrázků |

64 MiB označuje komprimovaná obrazová data. Paměť celého Chrome zahrnuje také JavaScript, dekodéry a grafické prostředky. Načtený balíček v moderování uchovává nejvýše 64 MiB ověřených obrazových Blobů. Sekvenční příprava a otevření zpracovávají pracovní kopie jednoho obrázku a jeden dočasný dekódovaný bitmapový objekt, který po ověření zavřou. Za běhu mohou probíhat až čtyři souběžné přenosy s dalšími pracovními kopiemi a vlastními Bloby v projektoru. Projektor má samostatný limit místních rolí a pixelů, počáteční bajty získává jen jednou a při obnově oprávnění si je znovu neposílá. Hodnotu celkové procesové RAM nelze odvodit ze samotné velikosti souboru.

Na detailu uzamčené akce slouží **Připravit zálohu obrázků** k přípravě všech způsobilých obrazových podkladů. Server zkontroluje aktuální členství, rozsah akce a `event.read` s `event.export`, sestaví vazby na snímky a role a přečte celé objekty z konkrétních generací. Ověří MIME, skutečnou délku, statický kontejner, rozměry a SHA-256. Čtení zakazuje transparentní dekompresi objektu a nepřijímá Content-Encoding. Nová kontrola identity a transakčního přiřazení po IO brání dokončení zastaralé přípravy.

V moderování lze načíst uložený soubor přes **Načíst zálohu obrázků**. Nejdřív se zkontroluje omezená hlavička včetně jejího kanonického SHA-256, aktuální serverové oprávnění a přesná délka celého souboru. Každý obrázek se zkopíruje do samostatného neměnného Blobu, ověří podle SHA-256 a skutečně dekóduje. Až po ověření všech položek a opětovném serverovém potvrzení může být soubor označen za připravený. Neúplný soubor, přidané bajty, změněný index nebo chyba jediného obrázku tento stav nepovolí.

Obrázky s EXIF otočením mohou mít po nativním dekódování prohozenou šířku a výšku. Kontrola přijímá pouze přesné původní rozměry nebo jejich přesnou transpozici. Raw rozměry, počet pixelů i SHA-256 zůstávají vázané na soubor. Syntetický JPEG 24 × 12 s orientací 6 byl v Chrome skutečně dekódován jako 12 × 24. [Výchozí orientace ImageBitmap podle HTML standardu](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagebitmapoptions-imageorientation)

Příprava ukazuje počet připravených položek, chybějící obrázky a vyloučení. HTTP zdroje, YouTube, Drive objekty, animované PNG/WebP, nepodporované kontejnery a nejednoznačné soukromé reference se nepřevezmou jako vlastní podporovaný obrázek. Překročení globálních limitů přípravu zastaví. Bezpečná opakovaná veřejná reference může sloužit jako více pozadí či log. Reference, která je zároveň veřejná a odpověďová nebo se vyskytne v neznámém soukromém poli, se z místní zálohy vyloučí.

Obrázky odpovědí a odpověďového designu jsou samostatně označené jako soukromé. Jejich export potřebuje současně `event.export`, `event.answers.read` a `event.answers.export`, stejně jako existující export odpovědí. Uživatel bez těchto oprávnění dostane veřejnou část a souhrn výluk bez soukromých referencí. Soubor obsahující odpověďové obrázky má soukromé označení a název. Jeho bajty nejsou šifrované, proto patří do chráněného umístění operátora a po akci se ručně odstraní. Texty odpovědí, poznámky, kontakty a přihlašovací údaje do souboru nevstupují.

Projektor se otevírá tlačítkem **Otevřít projektor** z téhož moderování ve stejném Chrome/Chromium a na stejném notebooku. Síťový zdroj začíná první. Po 1,5 sekundy čekání nebo po povolené přenosové chybě může začít výběr místní kopie. HTTP 401, 403, nejednoznačná 404, 410, 429, 500 a neplatná data přepnutí nepovolují. Síťové 502, 503, 504 a přenosové selhání mohou být důvodem pro nové ověření zálohy.

Před převzetím a znovu před použitím obrázku čte projektor vlastní aktuální veřejný stav ze serveru. `readLocalImageAuthority` v transakci sváže aktuální relaci, revizi, pozici, generaci přehrávání, snapshot, konkrétní veřejné pole a generaci souboru. Pro odpověďové obrázky vyžaduje skutečně zveřejněnou odpověď. V rekapitulaci kontroluje i explicitně vybranou zdrojovou otázku. Do projektoru přes jednorázový MessageChannel odchází pouze tento obrázek a jeho veřejná vazba. Celý soubor, seznam dalších podkladů, soukromý manifest a tokeny zůstávají v moderování.

Serverové potvrzení platí nejvýše pět sekund. Obnova přibližně po dvou sekundách obsahuje nové veřejné ověření i aktuální autorizaci operátora. Souběžné role sdílí pouze právě probíhající totožnou kontrolu operátora v jedné životnosti relay. Dokončený výsledek se neukládá. V průběhu obnovy dál běží původní expirace. Změna potvrzené revize, relace nebo generace zruší čekající výsledky a stará Blob URL. Pozdní úspěch sítě vybranou místní kopii nevymění. Přijaté zamítnutí ji odstraní. Moderování potvrzuje **Použita místní záloha** až po skutečném načtení obrázku projektorem.

Úplný výpadek internetu odstraní obraz při události offline nebo ztrátě serverového potvrzení. Nový místní obrázek vyžaduje dostupný Firebase. Samotný soubor nezajišťuje navigaci ani pokračování bodování bez serveru. Při tichém výpadku bez události offline ponechává lokální zdroj jen dosud platné krátké potvrzení. Po jeho vypršení se vyčistí.

Vlastní integritní údaj je uložený jako serverový `localImageIntegrityV3` u `quizzes/{quizId}/mediaAssets/{assetId}`. Obsahuje vazbu reference, generace, MIME, velikosti, hash, rozměry a ETag. Vzniká až po přečtení objektu a kontrole aktuálních oprávnění. Nenahrazuje živé oprávnění k obrázku. Konflikt jiného hashe pro stejnou generaci je chyba. Neúspěšná příprava může ponechat ověřené integritní údaje jednotlivých souborů, ale nedává oprávnění označit částečný balíček za připravený. Klienti tyto údaje nezapisují. Nové endpointy jsou omezené na demo emulátory a vyloučené z cloudových deploymentů.

Starší jednoobrázkový formát z etap 1–2 zůstává dostupný v původním pilotu s `?backupPilot=1`. Nový formát má vlastní značku verze 3. Jeho kontrola nepřijímá starší syntetický hash jako důkaz integrity jiných obrázků.

Praktická zkouška na notebooku a projektoru má zatím stav **NOT TESTED**.

1. Připravte Java 21, pnpm a Chrome. Zkontrolujte místní demo hodnoty podle `apps/web/.env.example`, především projekt `demo-filmovy-kviz-v2` a zapnuté emulátory. Zachovejte existující místní konfiguraci.
2. Spusťte `pnpm check` a poté `pnpm exec firebase emulators:start --only auth,firestore,functions,hosting,storage --project demo-filmovy-kviz-v2`. V druhém terminálu spusťte `pnpm seed:auth`. Pro účet použijte údaje místního seederu. Otevřete `http://127.0.0.1:5000/admin`.
3. V místní administraci vytvořte syntetický kvíz s vlastními barevnými PNG/JPEG/WebP. Zahrňte pozadí, logo a samostatný odpověďový obrázek. Uložte ho, přiřaďte k demo akci a uzamkněte snapshot.
4. Připravte zálohu na detailu akce. Zkontrolujte všechny položky a případné výluky. Uložte soubor na disk a znovu jej otevřete. Po úplném restartu Chrome se přihlaste, otevřete stejnou akci a tentýž soubor zkontrolujte znovu.
5. V moderování načtěte zálohu a tlačítkem otevřete projektor. Přesuňte popup na skutečný projektor a přepněte na celou obrazovku. Při běžném připojení ověřte obraz i síťový zdroj.
6. Pouze v DevTools projektorového okna blokujte požadavky obsahující `readQuizMedia`. Ostatní místní služby ponechte dostupné. Projděte všechny snímky s obrázky, včetně pozadí a log, a zkontrolujte označení místního zdroje i **Použita místní záloha**. Odpověďový obrázek se smí objevit až po odhalení a musí zmizet po skrytí či změně snímku.
7. Odhlaste operátora a zkontrolujte odstranění místního zdroje. Potom v DevTools obou oken samostatně nastavte **Offline**, aby se přerušila i komunikace s místními emulátory. Samotné odpojení Wi-Fi spojení s localhost neodstraní. Projektor musí oznámit chybějící spojení a nesmí dál předstírat potvrzenou online navigaci. Obnovte síť, znovu ověřte přihlášení a aktuální relaci a teprve potom pokračujte.
8. Zapište model a RAM notebooku, Chrome, rozlišení projektoru, počet a velikost obrázků, čas přípravy a pozorované přepínání. Sledujte paměť Chrome ve Správci úloh a zaznamenejte použitou metriku. Uveďte i případné chyby a přesný zdrojový commit. Po zkoušce soukromý soubor ručně odstraňte.

Automatizovanou sadu spouští `tests/browser/local-image-backup.config.ts` nad uvedenými emulátory:

```powershell
node tools/local-emulator-environment.mjs full node_modules/@playwright/test/cli.js test --config tests/browser/local-image-backup.config.ts
```

Závěrečný běh 8. 11. 2026 prošel všemi 15 scénáři etapy 3. V prohlížeči skutečně dekódoval všech 64 obrázků včetně JPEG s EXIF orientací. Ověřil soubor o 64 MiB dat, tři současné role, zveřejnění a opětovné skrytí odpovědi, změnu otázky během čekání, restart procesu Chrome, stejně dlouhé poškození dat, změnu indexu, přerušené dokončení zápisu, změnu oprávnění, odhlášení, konec relace a úplný síťový výpadek. Moderování při poškozeném čtvrtém obrázku ukázalo tři ověřené a jeden vadný; následné načtení původního souboru obnovilo čtyři ověřené položky. Přerušený nativní zápis je řízená simulace API, nikoli vytažení skutečného disku. Kontrola nedostatku místa zůstává také v regresi etapy 1; fyzicky plný disk nebyl zkoušen.

| Syntetický soubor | Příprava | Uložení | Opětovné otevření a kontrola | Velikost na disku |
| --- | ---: | ---: | ---: | ---: |
| 64 malých PNG/JPEG/WebP | 22 327 ms | 199 ms | 841 ms | 65 234 B |
| 7 PNG, přesných 64 MiB dat | 2 355 ms | 264 ms | 843 ms | 67 112 604 B |

Měření zahrnuje serverové ověření, kontrolní součty a skutečné dekódování každé položky v Chrome. Malý 64položkový případ běžel první; velký soubor až v zahřátých emulátorech. Velký případ používá sedm PNG o rozměrech 8 × 4 s legálními pomocnými bloky, aby ověřil skutečný bajtový limit. Nezatěžuje zároveň maximum bajtů i maximum dekódovaných pixelů a nezastupuje paměťový profil 64 velkých fotografií. Nejde o porovnání studeného a zahřátého startu stejného kvízu. Ověřené bajty jsou v souboru na disku a po novém spuštění prohlížeče se znovu načtou; OPFS ani interní cache nejsou nezávislou zálohou této etapy.

| Navigační příkaz → pozorování dekódovaného obrázku | Medián | p95 | Maximum | Selhání |
| --- | ---: | ---: | ---: | ---: |
| Běžná brána, bez souboru | 250,5 ms | 297 ms | 297 ms | 0/10 |
| Běžná brána, načtený soubor | 221,5 ms | 285 ms | 285 ms | 0/10 |
| Brána zpožděná o 3 500 ms, bez souboru | 4 092 ms | 4 101 ms | 4 101 ms | 0/10 |
| Brána zpožděná o 3 500 ms, načtený soubor | 2 285,5 ms | 2 571 ms | 2 571 ms | 0/10 |

Čas měří monotónní hodiny Node před testovým příkazem `fixture.navigate` / `goToSlide` až do Playwright pozorování dekódovaného IMG, včetně režie pollingu. Nejde o skutečný klik myší. Ze 40 pozorování bylo 30 online a deset místních; všechna se dekódovala. První vzorky zůstaly zahrnuté. Profily sdílely emulátory, Playwright routing vypínal HTTP cache. p95 je při deseti vzorcích pořadovou metodou roven maximu. Rozdíl běžných profilů nelze vykládat jako prokázané zrychlení zdravé sítě. Nejde o cloud, skutečnou síť provozovny ani měření fyzicky promítnutého obrazu.

Samostatný 64MiB případ má 21 vzorků součtu nativních pracovních sad procesů vlastního Chrome v přibližně sekundových intervalech. Výchozí hodnota byla 511,1 MiB, pozorované maximum i závěr 1 064,8 MiB, nárůst 553,7 MiB; čtení nemělo chybu. Sdílené stránky se mohou započítat vícekrát, Node a emulátory nejsou zahrnuté a vzorkování nezaručuje zachycení okamžitého maxima. Toto není pevný limit RAM ani důkaz přijatelnosti na cílovém notebooku. Paměťové profilování běželo mimo 40pokusové měření odezvy.

Před použitím je potřeba provést uvedenou fyzickou zkoušku a podle její RAM a dekódování případně snížit limity či předem zmenšit obrázky. Chybějící způsobilý obrázek blokuje připravenost; přehled výslovně uvádí vyloučené zdroje. Cizí HTTP, Drive a YouTube zůstávají mimo podporovanou zálohu. Zvuk, video, další prohlížeče a přenos na jiné zařízení nejsou v této etapě zavedené. Cloudové ověření je **NOT TESTED** a endpointy jsou nadále pouze pro demo prostředí.

Implementace je v `73f442281cbf12f76e9b815f2ec9cd913eaa7606`. Závěrečné kontroly prošly: `pnpm check`, 1 451 unit a komponentových testů, 33 prohlížečových scénářů (15 + 13 + 3 + 2) a 64 Rules testů. DEV, nezávislé QA i read-only SECURITY mají **PASS**, bez otevřených bezpečnostních blockerů v tomto omezeném lokálním rozsahu.
