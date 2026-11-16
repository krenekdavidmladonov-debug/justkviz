# JustKvíz V2 předávací log pro odborné posouzení

Datum: **14. října 2026**, Europe/Prague. Projekt: Filmový Kvíz V2 / JustKvíz. Zpracoval: AI koordinátor vývoje se třemi oddělenými kontrolami funkcí, zbývající práce a technické evidence. Tato zpráva je podklad pro nezávislého odborníka; není jeho nezávislým posudkem.

**Aplikace má implementovaný celý základní průběh kvízu od přípravy přes registrace a moderování po bodování, výsledky a PDF. Omezená staging akceptace a jedna skutečná e-mailová zpráva jsou doložené. Nelze ji ale označit za 100% dokončený veřejný nebo produkční provoz.** Nejnovější oprava tvorby kvízu je otestovaná, ale ještě není nasazená. Automatické e-maily jsou pozastavené. Zbývá vymezit a přijmout reálný pilot, dokončit příslušné provozní kroky a rozhodnout rozsah širšího spuštění.

Při sestavení logu byl ověřen místní Git, zdrojové soubory, aktuální dokumentační souhrny a vybrané uložené kontrolní součty. Nebyly znovu spuštěny testy ani proveden nový cloudový audit. Cloudové a GitHub výsledky níže znamenají **poslední doložený stav**, nikoli nové měření v okamžiku čtení tohoto dokumentu. Zpráva neobsahuje hesla, OAuth kódy, tokeny, soukromé adresy ani obsah chráněných grantů.

## 1 Přesná verze a rozsah nasazení

| Část | Identifikace | Doložený stav |
| --- | --- | --- |
| Místní základ této inspekce | `f83142e996a66c90655d880cbeca420c04252924`, větev `codex/final-project-closure` | Pracovní strom byl před vznikem tohoto logu čistý. |
| Publikovaný a otestovaný kandidát | `1f5443174fa2b560311665faf0e2094acbcab567` | Místní HEAD se od něj liší pouze pěti stavovými dokumenty; aplikační zdroj je stejný. |
| Oprava obnovy tvorby kvízu | `313df9f9573f45a8447aebdfee3963f413f52429` | Součást kandidáta; jednotkové, browser a CI ověření hotové. |
| Integrace do hlavní větve | [PR 39](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/pull/39), OPEN/DRAFT; base `0d452d8efe4cce9eb003fcce713d3b63c15bb0a4` | Kandidát je publikovaný v PR, nikoli sloučený do `main`. |
| Staging web a ostatní základní aplikační cíle | `ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac` | Poslední doložená Hosting verze `5d6d0e6b0f400501`. Nová oprava tvorby kvízu na webu ještě není. |
| Staging Storage Rules | `5fe7d9ba2f4f17dd1c8e727896ea7faa92b713fe` | Samostatně schválená a nasazená oprava přístupu k vlastním médiím. |
| Staging registrační e-maily | Pět Functions z balíčku `f19c54dab8afaaf88a4d2b5a44d066174fe8165e`; prováděcí politika `b72f3e33d4b3ecc9d7a46770e676aff551a33de0` | Nasazeno a ověřeno samostatně. Jedna schválená zpráva doručena; fronta PAUSED. |
| Připravený nový web | 37 souborů, zdroj `1f544317…` | Neměnný balíček, nasazovací postup, kontrola a podmíněný návrat připraveny. Konkrétní schválení tohoto vydání dosud čeká. |

Cílový staging je `filmovy-kviz-v2-staging`; web je dostupný na [staging přihlášení](https://filmovy-kviz-v2-staging.web.app/admin/login). Produkční aplikace V1 a její Firebase projekt nejsou tímto rozsahem dotčené. Novější commit v repozitáři neznamená, že celý jeho obsah běží v cloudu.

Rozdíl kandidáta proti uvedenému `main` má **372 změněných souborů, 18 716 vložených a 1 513 odstraněných řádků**, včetně dokumentace a nástrojů. Odborný review proto musí posoudit celý věcný rozsah PR, nejen poslední malou opravu. Vazby verzí jsou v [publikační evidenci](SUCCESSOR_PUBLICATION.md) a [provozní připravenosti](FINAL_LAUNCH_READINESS.md).

## 2 Co aplikace umí

Technický základ tvoří TypeScript, React/Vite, Firebase Authentication, Firestore, Storage a Cloud Functions. E-mailová cesta používá Cloud Tasks, Secret Manager a Gmail API. Repozitář je pnpm workspace; Functions cílí na Node.js 22. Bezpečnostní rozhodnutí se provádějí na serveru a v Rules, nikoli pouze v navigaci webu. Viz [architektura](ARCHITECTURE.md), [datový model](DATA_MODEL.md) a [bezpečnost](SECURITY.md).

| Oblast | Implementované schopnosti | Podstatná hranice |
| --- | --- | --- |
| Účty a oprávnění | Osobní účty, aktuální aktivní členství, konkrétní oprávnění a rozsah kvízu/akce; pozvánky a odvolání přístupu. | Samotné přihlášení, role nebo staré Auth claims nedávají oprávnění. Pozvánky zůstávají pozastavené. |
| Knihovna kvízů | Soukromá knihovna, založení kvízu, kontrolovaný přístup; nově obnova stejného pokusu po ztracené odpovědi serveru. | Poslední oprava obnovy je v kandidátovi, ale čeká na vydání webu. |
| Editor | Kola, úvod, pravidla, harmonogram a závěr; textové, obrazové, audio a video zadání; otevřené odpovědi a výběr z 2–6 možností. | Neúplný koncept není připravený k hraní. Podpora video zadání neznamená upload nebo převod videa. |
| Organizace obsahu | Kopírování, přesuny a pořadí otázek/kol, osnova, klávesové přesuny, odstranění obsahu podle oprávnění. | Delší složené přesuny mohou skončit částečně; nejedná se o univerzální atomickou operaci. |
| Ukládání | Sdílená pracovní kopie v editoru, Uložit vše, Ctrl+S, ochrana při opuštění, revizní konflikty a kontrolované opakování. | Rozepsaná práce je v paměti; není autosave ani obecná obnova draftů po zavření či offline synchronizace. Uložit vše je sekvence transakcí. |
| Připravenost a zkouška | Kontrola blokujících chyb, cílené opravy, soukromý náhled a zkouška se společným rendererem. | Soukromá zkouška nevytváří veřejnou live session a nedokazuje funkci fyzického projektoru. |
| Akce | Založení a nastavení akce, kapacity a registrační okno; příprava neměnného snapshotu kvízu. | Pozdější úprava knihovny nepřepisuje připravený snapshot. |
| Životní cyklus akce | Zrušení, návrat do přípravy, archivace, koš, obnovení a řízené trvalé smazání. | Destruktivní operace mají další ochrany; skutečné smazání nebylo součástí dokončené cloudové QA. |
| Registrace a týmy | Veřejný seznam/detail, přihlášení týmu, kapacity a jména; správa/zrušení přes soukromý odkaz; administrativní správa, reissue odkazu a QR. | Odkaz obsahuje oprávnění k dané registraci. Čekací listina není dodaná; automatický potvrzovací e-mail se nyní neočekává. |
| Moderování a projektor | Navigace, ručně spouštěná média, rekapitulace, explicitní odhalení odpovědí a ukončení; sanitizovaná veřejná projekce. | Správná odpověď ani soukromé poznámky nesmějí uniknout před odhalením. Běžné audio přehrává moderátor; externí média potřebují odpovídající připojení. |
| Bodování a rozhodčí | Ruční body po kolech včetně půlbodů, zdůvodněné opravy, historie a revizní konflikty; omezený přístup rozhodčího ke konkrétní akci. | Uložení skóre samo nezveřejní výsledky. Automatický příjem a vyhodnocení odpovědí týmů není součástí této dodávky. |
| Výsledky | Náhled a publikace průběžných výsledků, postupné finální vyhlášení, konečná tabulka a potvrzená historie dokončené akce. | Historie čte potvrzenou verzi; nepřepočítává ji z aktuálních změn a neobsahuje rozpad po kolech. |
| PDF a tisk | Týmové listy, klíč odpovědí a bodovací tabulka, náhled a stažení; údaje o přijatých týmech načítá server. | Klíč vyžaduje zvláštní oprávnění. PDF bylo vizuálně ověřeno, skutečný tisk na místě nikoli. |
| Média | Upload vlastních PNG/JPEG/WebP a MP3/WAV, soukromá média otázky/odpovědi/pozadí, chráněná distribuce, adaptéry odkazů a YouTube. | Bez uploadu videa, transcodingu a automatické offline synchronizace. |
| E-maily | Registrační a organizační outbox, kontrolované retry/replay; samostatně aktivovaná registrační cesta do Gmailu. | Doložena jedna povolená zpráva. Fronta PAUSED; běžný automatický dispatch ani organizační/team e-maily nejsou zapnuté. |
| Místní provoz a vzhled | Demo QA launcher, oddělený místní event-night režim, export/import/checkpoint a řízená obnova; tmavý vzhled JustKvíz. | Místní režim není cloudová synchronizace. Výpadek napájení na skutečné sestavě není ověřen; samostatný světlý motiv není dodaný. |

Ověřitelné vstupní body jsou v [README](../README.md), [routeru](../apps/web/src/app/router.tsx), [editoru](EDITOR_WORKING_COPY.md), [registracích](REGISTRATIONS.md), [bodování](EVENT_SCORING.md), [vyhlášení](FINAL_REVEAL.md), [historii](HISTORICAL_RESULTS.md) a [místním provozu](EVENT_NIGHT_LOCAL.md). Podrobnou vazbu funkcí na akceptaci obsahuje [completion matrix](COMPLETION_MATRIX.md).

## 3 Log významných dokončených prací

| Období | Změna nebo kontrola | Výsledek |
| --- | --- | --- |
| 12. října | Navázání na existující práci, opravy registračních revizí, editorového focusu a manuální agendy, přerušené obnovy checkpointu. | Integrovaný kandidát `ddb862f`; lokální kontroly, CI a schválené staging nasazení. [Evidence](COMPLETION_VALIDATION.md). |
| 12.–13. října | Omezená online QA editoru, médií, týmů, bodování, projekce, finále, historie a PDF. | Doložený průchod se syntetickými daty. Storage oprava a samostatná časově omezená kontrola dvou médií dokončeny. [Záznam](STAGING_QA_EXECUTION_DDB862F.md). |
| 13. října | Doplnění chybějící Save-all regrese/CI, skutečný místní restart Auth/Firestore/Storage, opravy Windows testovacího prostředí a příprava e-mailového balíčku. | Nové příslušné lokální/CI důkazy; zachována původní selhání a omezení. [Publikace](SUCCESSOR_PUBLICATION.md), [restart](EVENT_NIGHT_RESTART_ACCEPTANCE.md). |
| 14. října | Vyřešení OAuth callbacku, validace standardního issuer parametru a nový platný send-only consent. | Chráněný grant získán; dřívější odmítnuté a expirované pokusy se nepřehrávaly. [OAuth evidence](GMAIL_OAUTH_CONNECTION.md). |
| 14. října | Schválené zapnutí APIs, secrets/IAM/queue, nasazení pěti e-mailových Functions a oprava jejich startup konfigurace. | Pět ACTIVE Functions, privátní workers a konkrétní verze secrets ověřeny. [Prováděcí záznam](EMAIL_ACTIVATION_EXECUTION.md). |
| 14. října | Jediný schválený skutečný e-mailový smoke. | Jeden RunTask, stav sent, attempts 1, beze změny při terminal replay; vlastník potvrdil právě jednu zprávu a správného odesílatele. Fronta zůstala PAUSED. |
| 14. října | Oprava ztracené odpovědi při založení kvízu, obnova po reloadu, staré request ID a oddělení účtů. | Commit `313df9f`, šest cílených testů a skutečný browser případ; kandidát `1f544317` prošel všemi třemi CI joby. Nový webový release zatím neproveden. |

## 4 Co přesně dokazují kontroly

Aktuální [CI 38550477854](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/runs/38550477854) a [operator CI 38550477906](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/runs/38550477906) mají uložený výsledek SUCCESS. Skutečný CI checkout `8c89312bdf73b2a2b740f33c298b747292b5a9e9` má rodiče uvedeného base a kandidáta; jeho strom `d8599857aed96de0f9bfb06d50b3d874bcfaaccd` odpovídá kandidátovi. Kontrola se opírá o úplné logy i metadata, nikoli pouze zelený odznak.

| Kontrola | Doložený výsledek | Jak výsledek číst |
| --- | --- | --- |
| `pnpm check` | Typecheck, lint, build PASS. | Tento příkaz sám nespouští všechny testy. |
| Jednotkové testy | 485 testů v 50 souborech PASS. | Samostatná Functions sada 57 je podmnožina, nepřičítat ji k 485 jako nové případy. |
| Rules | 50 standardních a 10 samostatných access Rules případů PASS. | Operator job znovu spouští 50 standardních; nejde o další unikátní pokrytí. |
| Offline Node kontroly | 147 PASS, dvě Windows-only přeskočení na Ubuntu. | Přeskočené případy nejsou PASS na Ubuntu. |
| Windows | 44 PASS, bez skips. | Zahrnuje skutečné Windows ACL/DPAPI a lokální helpery, nikoli nové Google přihlášení nebo odesílání. |
| Operator security | 24 testů, skutečné emulátorové takeover/concurrency scénáře a Rules PASS. | Syntetická bezpečnostní evidence; nejde o produkční zásah. |
| Browser a endpoint průchody | Editor, média, registrace, email capture, lifecycle, bodování, finále a další deklarované CI brány PASS. | Nová creation recovery je součástí tří seeded případů. Sedm Save-all případů se spouští také v outline konfiguraci; nesčítat duplicitně. |
| Místní obnova | Tři skutečné starty emulator Suite; persistence Auth/Firestore/Storage, replay a recovery PASS; starší 130 filesystem assertions PS5/PS7. | Není to důkaz odolnosti proti výpadku proudu, havárii OS nebo celé reálné akci. |
| Staging uživatelská QA | Omezený editor/media/registrace/scoring/live/history/PDF průchod PASS. | Přesně vymezené identity a data; netestoval každou funkci proti cloudu. |
| Skutečný e-mail | Provider acceptance plus oddělené lidské potvrzení přijetí jedné zprávy. | Nepotvrzuje dlouhodobý dispatch, hromadné odesílání, deliverability všech příjemců ani fyzickou exactly-once záruku. |

Při tomto předání byly znovu přepočteny shodné hashe tří CI logů, výsledného manifestu, deseti navázaných review záznamů a připraveného Hosting balíčku/postupu. Testy nebyly opakovány. Přibližně 981 kB bundle warning zůstává neblokující, ale patří do nezávislého posouzení výkonu.

## 5 Co zbývá dokončit

| ID a priorita | Zbývající práce | Kdo rozhodne nebo provede | Podmínka uzavření |
| --- | --- | --- | --- |
| R1 před vydáním opravy | Nasadit hotovou opravu tvorby kvízu pouze na V2 staging Hosting. | Vlastník potvrdí připravený konkrétní release; koordinátor provede nasazení a ověření. | Shodný aktuální live pointer, přesný 37souborový balíček, nový release a úspěšné 3 metadata + 5 statických HTTP kontrol; při selhání posouzený podmíněný návrat. |
| R2 před přijetím pilotu | Stanovit termín, účastníky, zveřejnění registrace a provozního/záložního odpovědného; provést pilot na skutečném vybavení. | Vlastník a člověk na místě; technické chyby řeší koordinátor. | Přijatý průběh jedné nové V2 akce/kvízu se dvěma známými týmy, obrazem, zvukem, připojením, fyzickým tiskem, napájením a obnovou. [Runbook](V2_PILOT_RUNBOOK.md). |
| R3 při uzavření vývoje | Nezávislý review a integrace PR 39 do canonical `main`. | Odborník/reviewer a vlastník podle schváleného merge postupu. | Přijatý rozsah, vyřešené nálezy a doložený merge konkrétního kandidáta. Dnešní OPEN/DRAFT PR není merge. |
| R4 před běžnými e-maily | Vymezit příjemce, dispatch, sledování fronty/selhání, kvóty a obnovu Gmail grantu; teprve pak aktivovat širší provoz. | Vlastník určí provozní rozsah a odpovědnost; koordinátor připraví a provede schválené změny. | Konkrétní omezení a monitoring, kontrolovaná změna allowlistu/queue a provozní akceptace. Další zprávy ani resume nejsou součástí hotového jednorázového smoke. |
| R5 před širokým veřejným spuštěním | Schválit vystavení veřejných registrací, ochranu proti zneužití a uchování kontaktů/přístupových odkazů. | Produktový vlastník, případně příslušný odborník; vývoj doplní odsouhlasené rozdíly. | Zdokumentovaná pravidla, odpovídající implementace a ověření. Existující create retry a staff reissue už jsou hotové. |
| R6 před dalším autonomním provozem | Sjednotit stav automatizace a odstranit matoucí aktuální tvrzení v dokumentaci. | Koordinátor podle doloženého skutečného stavu a již daného provozního pokynu. | Vyřešené nálezy D1–D4 níže; shodný skutečný stav, instrukce a stavová dokumentace. |

Produkční přechod, skutečná migrace V1, širší pozvánky/noví rozhodčí a odstranění uchovaných QA dat jsou **samostatné možné rozsahy**, nikoli automatická součást omezeného V2 pilotu. Pokud má „100 %“ znamenat náhradu původní produkční aplikace, musí být výslovně přijaty i konkrétní migrační a produkční podmínky. Syntetické migrační testy nejsou důkazem reálného přenosu dat.

Offline synchronizace, video upload/transcoding, čekací listina, světlý motiv, náhled draftu napříč zařízeními a další návrhy ze starých roadmap nejsou automaticky nedodělanými slíbenými funkcemi. Odborník s vlastníkem má potvrdit, zda jsou mimo dodávku, nebo patří do nového zadání.

## 6 Nové nálezy při přípravě tohoto logu

| ID | Zjištění | Dopad a další krok |
| --- | --- | --- |
| D1 | [REGISTRATION_SECURITY.md](REGISTRATION_SECURITY.md) stále tvrdí, že staging email je vypnutý a sender/deployment/send acceptance chybí. | Tvrzení je zastaralé vůči dokončené omezené aktivaci a potvrzenému doručení. Opravit aktuální provozní popis; zachovat rozdíl mezi funkční cestou a PAUSED dispatch. |
| D2 | [PRINT_CENTER.md](PRINT_CENTER.md) obsahuje starý popis bez skutečných registrací a se syntetickými týmovými jmény z browseru. | Současný [typ požadavku](../functions/src/print/types.ts) používá `teamId` a [endpoint](../functions/src/print/endpoint.ts) načítá přijaté registrace serverově. Sjednotit dokumentaci s kódem. |
| D3 | [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md) obsahuje historické „admin-only“ a někdejší chybějící staging bucket. | Současná autorita je membership/permission/scope a omezená staging media QA už proběhla. Historii výrazně označit a odkázat na aktuální kontrakt. |
| D4 | Místní soubor `C:\Users\krene\.codex\automations\samostatn-dokon-en-justkv-z\automation.toml` při tomto auditu uvádí `status = "ACTIVE"`, zatímco stavová dokumentace tvrdí PAUSED. | Je doložen rozpor konfigurace a dokumentace. Samotný příznak neprokazuje, že scheduler právě pracuje nebo co vykonal. Ověřit skutečné nastavení aplikace a sjednotit jej; tato zpráva automatizaci neměnila. |

Historické odstavce v [completion matrix](COMPLETION_MATRIX.md), [publikační historii](SUCCESSOR_PUBLICATION.md) a starých produktových registrech obsahují původní blokace, které jsou novějšími částmi překonané. Je nutné číst datum a rozsah, ne převzít samostatnou větu jako aktuální TODO.

Tato kontrola nedoložila další novou neopravenou runtime chybu v kontrolovaných cestách. Poslední potvrzená chyba tvorby kvízu je opravená ve zdroji a čeká na release. Obnova po reloadu zároveň závisí na dostupném browser storage; při jeho odmítnutí je zaručena pouze obnova v rámci stále otevřené stránky. To je známé omezení, nikoli doklad všeobecné bezchybnosti.

## 7 Co zajišťuje AI koordinace a co musí potvrdit člověk

V tomto projektu koordinátor přiděluje ohraničené úlohy nejvýše třem pracovníkům, kontroluje výsledky, sjednocuje změny a váže je na konkrétní commit a testy. Pro tuto zprávu pracovaly tři oddělené read-only kontroly na GPT-6.1 Sol: funkce MEDIUM, zbývající práce MEDIUM a evidence LOW. Není tvrzeno, že koordinátor změnil vlastní model nebo reasoning nastavení.

Autonomně lze v dohodnutém rozsahu provádět analýzu a úpravy kódu, regresní testy, demo emulátory, přípravu balíčků, lokální commity, dokumentaci a nezávislou kontrolu pracovníků. Konkrétní schválený externí krok lze následně provést a ověřit. Tento log ani běžný heartbeat nejsou novým souhlasem s nasazením, e-mailem nebo rozšířením přístupů. [AGENTS.md](../AGENTS.md) a [vývojový postup](DEVELOPMENT_WORKFLOW.md) stanovují skutečné hranice.

Člověk musí určit produktový a provozní rozsah, poskytnout potřebný legitimní přístup a potvrdit výsledky na skutečné sestavě. AI nenahrazuje lidské přihlášení tam, kde je vyžadované, fyzickou zkoušku projektoru/zvuku/tisku ani odpovědnost za veřejný provoz. Odchozí testovací e-mail už člověk potvrdil; stejný vstup není znovu potřeba.

## 8 Podklady a doporučený rozsah odborného posouzení

Odborník má nejprve určit, co je cílem převzetí: omezený staging pilot, běžná V2 služba, nebo náhrada produkce V1. Pro tento cíl doporučuji posoudit:

1. Soulad skutečných požadavků s implementací a testy; zejména limity ukládání, obnovy, médií a veřejného provozu. Úplná mapa každého požadavku na test není doložená.
2. Autorizační hranice členství/oprávnění/scope, odvolání účtu či grantu a oddělení soukromých odpovědí/kontaktů od veřejné projekce. Lokální důkazy nenahrazují nezávislý bezpečnostní review.
3. Rozsah draft PR, zdrojové a nasazené verze, úplné CI logy a skutečné vazby artefaktů. Žádná část nesmí být prohlášena za nasazenou jen podle HEAD.
4. Registrační capabilities a token rotation, souběžné zápisy, retry po nejasném výsledku a e-mailové selhání. Queue PAUSED a spotřebovaný jednorázový send rozpočet musí zůstat respektované.
5. Provozní monitoring, náklady/kvóty, obnovu, dostupnost médií a reálný pilot. Cloudový rollback je připravený jako postup, ale jeho provedení nebylo nacvičené.

Výstup odborníka by měl u každého nálezu uvést závažnost, reprodukční kroky nebo konkrétní zdrojový řádek, dotčenou verzi, požadovanou opravu a akceptační důkaz. Pouhý součet testů ani odhad procent nenahrazuje přijetí požadavků.

### Mapa zdrojů

| Účel | Dokument nebo zdroj |
| --- | --- |
| Aktuální koordinace a historie oprav | [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) |
| Funkce a zbývající provozní podmínky | [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md), [FINAL_LAUNCH_READINESS.md](FINAL_LAUNCH_READINESS.md) |
| Kandidát, CI a připravený nový web | [SUCCESSOR_PUBLICATION.md](SUCCESSOR_PUBLICATION.md) |
| Dosavadní nasazení a online QA | [STAGING_EXECUTION_DDB862F.md](STAGING_EXECUTION_DDB862F.md), [STAGING_QA_EXECUTION_DDB862F.md](STAGING_QA_EXECUTION_DDB862F.md) |
| OAuth a skutečné doručení | [GMAIL_OAUTH_CONNECTION.md](GMAIL_OAUTH_CONNECTION.md), [EMAIL_ACTIVATION_EXECUTION.md](EMAIL_ACTIVATION_EXECUTION.md) |
| Pilot a místní QA | [V2_PILOT_RUNBOOK.md](V2_PILOT_RUNBOOK.md), [LOCAL_QA.md](LOCAL_QA.md) |
| Přesné příkazy a dependency lock | [package.json](../package.json), [pnpm-lock.yaml](../pnpm-lock.yaml), [CI workflow](../.github/workflows/ci.yml) |

### Kontrolní součty hlavních uložených důkazů

Základní adresář níže je `.local-data/project-closure-20261014/`. Tyto soubory jsou ignorované Gitem a nejsou automaticky součástí klonu pro odborníka.

| Soubor | SHA256 |
| --- | --- |
| `final-ci-verification.json` | `8bd372519f99d1decf33b290dffef5ddd47ed10f638ef7ebb69bebfe7d166e15` |
| `final-review-low.completion.json` | `d7bb927409aee08168a965a60b593f6f8b1b29390d854aa14ce5c96102c6500f` |
| `quality.log` | `08d22d3e126fb80e08d9829a3b3f5489c88f06951c3b367bd54a85bb21d95b76` |
| `windows.log` | `6c40d5dc7d04682879d97e85b4eeb910bff243e1c7ee7d4e68920750c7ff8329` |
| `operator.log` | `f2158ff7eb8830c389a1121454234230fd8e6139f352583def8c6a6dd48e260f` |
| `hosting-1f5443174fa2b560311665faf0e2094acbcab567/receipt.json` | `74b96bef9cdb1bff3daa74cb590c68d23bb996d516f3cff79783b8211931cd9a` |

Pro přezkoumání kódu je potřeba přístup k přesnému kandidátovi a související dokumentaci. Pro ověření důkazů lze předat vybrané zkontrolované logy a sanitizované receipts samostatně. **Nepředávat celý `.local-data`, `.env`, Firebase/Google přihlášení, OAuth JSON ani chráněné granty.** Samotný kontrolní součet dokazuje shodu souboru, ne správnost závěru uvnitř. Do této zprávy nebyly soukromé podklady přibaleny ani odeslány třetí straně.
