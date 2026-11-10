# Offline kvízový večer

Příprava ve V2 je dostupná po samostatně schválené aktivaci pro danou akci. Fyzický projektor, zvukový výstup a restart Windows vyžadují generálku podle postupu níže. Správce vydání najde nastavení a rollback v [plánu vydání](OFFLINE_RELEASE.md).

Přenosný večer používá příponu `.justkvizoffline`; dřívější obrázková `.justkvizbackup` má jiný účel a není souborem celého offline večera.

Online JustKvíz nadále používá Firebase. Offline večer se otevírá samostatně na `/offline.html`; nepřepíná se do něj automaticky při chybě spojení. Předem připravené oprávnění platí pro jedinou akci, snapshot a offline relaci. Stejný soubor neumožňuje otevřít jiné akce ani obejít serverová oprávnění.

## Příprava před odjezdem

1. Na notebooku otevřete administraci JustKvízu V2 a přihlaste se. Akce musí mít uzamčený kvíz, přijaté týmy a ukončenou případnou online projekci.
2. V detailu akce otevřete **Připravit offline kvíz**. V kroku **Zkontrolovat kvíz** se automaticky ověří uzamčená verze, potvrzené týmy, oprávnění, dostupnost médií, předběžná platnost a odhad místa prohlížeče. Pokud médium chybí nebo má externí zdroj, průvodce ukáže snímek a popíše opravu.
3. V kroku **Vytvořit offline balíček** zadejte samostatné heslo a potvrďte je. Uchovejte heslo odděleně od souboru. JustKvíz stáhne, ověří a vyzkouší dekódování médií a ukáže skutečný počet zpracovaných souborů. Chrome potřebuje povolit uchování dat a může nabídnout instalaci aplikace.
4. Uložte `.justkvizoffline` na disk. Při přímém uložení JustKvíz soubor znovu přečte a ověří. Pokud prohlížeč nabízí stažení, počkejte na jeho dokončení a vyberte soubor v kroku **Ověřit stažený soubor**. Přenosný soubor na disku a uložený průběh v prohlížeči jsou dvě samostatné kopie.
5. V kroku **Připravit notebook** JustKvíz vyzkouší, že se aplikace na tomto zařízení spustí bez sítě a může trvale uložit průběh. Pokud budete hrát jinde, zvolte **Budu hrát na jiném notebooku**. Přeneste soubor a na cílovém notebooku otevřete stejnou akci online. V přípravě cílového notebooku se ověří podpisový klíč a uloží aplikace. Potom zvolte **Načíst přenesený kvíz** a otevřete ho heslem.
6. Před odjezdem zavřete Chrome, odpojte síť, spusťte uloženou offline aplikaci, otevřete kvíz a vyzkoušejte projektor, obrázek, video i zvuk. V demo prostředí vypněte také místní emulátory nebo zablokujte jejich požadavky.

Opakovaná příprava ověří dříve uložený balíček heslem a zkontroluje ho proti aktuální akci. Při zastarání nebo vypršení oprávnění průvodce nabídne novou přípravu. Rozhraní pro rozehraný kvíz nabídne otevření uloženého průběhu nebo synchronizaci výsledků.

Příprava vyžaduje platné členství a oprávnění `event.read`, `event.export`, `event.answers.read`, `event.answers.export`, `event.notes.read`, `event.live`, `event.score` a `event.manage` pro konkrétní akci. Moderátor potřebuje výslovně přidělená oprávnění. Notebook při online přípravě ověří veřejný klíč serveru. Přenesený soubor tento klíč nemění.

## Hraní a ochrana průběhu

1. Otevřete **Spustit offline kvíz**, načtěte připravený soubor a odemkněte ho jeho heslem. Po restartu je nutné heslo zadat znovu.
2. Otevřete projektor z odemčeného moderování na témže notebooku. Publikum dostává jen aktuálně povolený veřejný snímek a jeho jednotlivá média; nedostává balíček, klíč, soukromé odpovědi ani poznámky.
3. Zahajte večer a ovládejte snímky, odpovědi, rekapitulace a přehrávání. Běžná otázková zvuková ukázka hraje v moderátorském okně, jako v online systému. Zveřejněné audio v rekapitulaci hraje projektor. Video se nemá souběžně přehrávat i v náhledu moderátora. Časové rozsahy ukázek zůstávají zachované; samotné odhalení odpovědi je nerozšiřuje.
4. Body zadávejte místně po kolech. Poloviční bod je podporovaný; nula je platná zadaná hodnota, prázdné pole znamená chybějící hodnocení. Oprava už zadaných bodů vyžaduje důvod. Potvrzení je možné až po dokončeném trvalém zápisu.
5. Sledujte průběžné a konečné pořadí. Remízy používají stávající husté pořadí: 1, 2, 2, 3. Zveřejňuje se pouze zvolená stránka.
6. Pravidelně stahujte nouzový soubor s dosavadním průběhem. Obnova novější historie je výslovná a ověřuje společný začátek; starší soubor nesmí vrátit potvrzené body zpět. Druhé moderátorské okno nesmí současně zapisovat do stejné relace.
7. Při zavření moderování se stav znovu odemkne z trvalého úložiště. Poškození či nedostatek prostoru nesmějí vyvolat potvrzení neuložených bodů. Při výrazné chybě zachovejte původní soubory a použijte ověřenou nouzovou kopii.

Při opětovném otevření aplikace ověří aktuální schopnost startu bez sítě, trvalé uložení a postupně všechna místní média. Pokud něco chybí, otevře ověřený průběh pro obnovu nebo synchronizaci a zakáže pokračování v hraní i projekci. Stejný nebo starší balíček sám uložený průběh nepřepíše; pro práci s existujícím večerem použijte **Odemknout a pokračovat**. Nouzový export celého večera potřebuje čitelné kopie všech médií.

Oprávnění běhu je omezené nejvýše na 72 hodin a konec povoleného období akce. Změnu oprávnění na serveru nelze při úplném odpojení okamžitě zjistit. Po expiraci se nové místní příkazy odmítnou; čtení a nouzový export dosavadních dat zůstávají dostupné. Kontrola nejvyššího viděného času chrání před neúmyslným vrácením hodin. Není ochranou proti vlastníku operačního systému, který úmyslně mění čas nebo obnovuje staré úložiště.

## Návrat online

Po obnovení připojení se znovu přihlaste do online administrace. V offline moderování otevřete **Synchronizovat výsledky** a porovnejte místní a serverový stav. Náhled nic nezapisuje. Samotné offline oprávnění nikdy není přihlašovací údaj pro Firebase.

Potvrzení synchronizace znovu ověří aktuální členství, oprávnění, akci, snapshot, seznam týmů, revize a hodnoty všech bodovacích buněk i vazby výsledků a relací. Celý záznam operací se zkontroluje a zápisy bodů, historie, výsledkové verze, ukončené relace a potvrzení importu proběhnou v jediné transakci.

Při konfliktu bodů uvidíte původní, místní i online hodnotu. Bez výslovné volby se nic nepřepíše. Lze ponechat online body nebo potvrdit místní hodnotu s důvodem a novým přezkoumaným náhledem. Jiný snapshot, změněné týmy, média, oprávnění nebo souběžná online prezentace se tím obejít nedají. Původní offline operace i rozhodnutí se zachovají v serverovém záznamu; původní online historie se nemaže.

Ztracená odpověď po úspěšném zápisu se řeší opakováním stejného importu, nikoli přičtením bodů znovu. Výsledky se označí za synchronizované až po skutečném serverovém potvrzení a jeho místním uložení.

Před odesláním potvrzení aplikace odolně uloží záměr synchronizace v šifrovaném místním průběhu. Ten váže požadavek na přesnou historii, náhled a rozhodnutí o konfliktech. Do dokončení se nepřijímají další místní příkazy ani hlášení přehrávače. Síťová chyba, ztracená odpověď nebo neúspěšné místní uložení potvrzení zámek neruší; zachová se i po zavření a odemčení téhož uloženého večera. Použijte **Znovu ověřit synchronizaci**, které opakuje původní požadavek. Nahrazení tohoto místního průběhu nouzovým souborem je do vyjasnění odmítnuto.

Výslovné odmítnutí prvního pokusu kvůli změně náhledu před serverovým zápisem dovolí nové porovnání. U opakování po předchozí nejednoznačné odpovědi zůstane historie uzamčená, dokud server nepotvrdí stejný import; samotná další chyba nedokazuje, že starší požadavek nic nezapsal. Tento zámek náleží konkrétnímu místnímu úložišti. Přenosný formát `JUSTKVIZ-OFFLINE/1` se nemění a nenese místní rozpracovaný záměr synchronizace; otevření starší nebo nouzové kopie v jiném profilu nepotvrzuje, zda již původní profil import odeslal. V takové situaci nejprve ověřte online výsledek a zachovejte původní profil.

## Deklarované limity

| Oblast | Limit |
| --- | --- |
| Akce | Jeden uzamčený snapshot a jedna jednoznačná offline relace |
| Struktura | 400 snímků, 20 kol, 100 týmů; současně nejvýše 200 týmových bodovacích buněk |
| Historie | 2 000 příkazů, 250 jednotlivých změn skóre, nejvýše 512 KiB žurnálu |
| Média | 256 vlastních souborů, součet nejvýše 512 MiB |
| Jeden soubor | Obrázek 10 MiB; audio/video 25 MiB |
| Formáty | Statické PNG, JPEG, WebP; MP3, WAV; MP4 s podporovaným kodekem ověřeným na notebooku |
| Přenosný formát | Verzovaný `JUSTKVIZ-OFFLINE/1`, bez komprese, autentizované části do 4 MiB |
| Ochrana | AES-256-GCM, PBKDF2-HMAC-SHA256, náhodná sůl a nonce; podpis P-256 ověřovaný proti předem připnutému klíči |

Tyto bajtové limity nejsou limitem celkové RAM. Prohlížeč navíc používá paměť pro kopie, dekódované obrázky, audio/video a grafické prostředky. Praktické limity musí potvrdit měření na cílovém notebooku. YouTube, libovolné HTTP, Drive a další externí zdroje se automaticky nestahují. V editoru otázky použijte **Nahrát z počítače** a vložte vlastní soubor, který smíte použít. Video musí být MP4 do 25 MiB s obrazovou stopou, kterou Chrome na notebooku skutečně dekóduje.

Samostatné hudební podkresy online Show Mode nejsou otázková média. Pokud jsou v akci zapnuté, příprava je výslovně označí a zastaví se. Vypněte tuto volitelnou hudbu nebo vlastní ukázku zařaďte jako zvukový snímek kvízu; žádná zapnutá konfigurace se nemá tiše vydávat za zahrnutou.

Šifrovaný soubor obsahuje neveřejné otázky, odpovědi, potřebné poznámky a názvy/ID týmů. Neobsahuje registrační kontakty, přihlašovací hesla, Firebase tokeny ani privátní podpisový klíč. Po odemčení jsou potřebná soukromá data v paměti moderování; notebook je důvěryhodné zařízení provozovatele. Při vymazání dat aplikace nebo celého profilu může být nutná nová instalace online. Pokud je poškozený samotný žurnál a jeho bezpečná výměna se odmítne, zachovejte původní profil. K ověřené nouzové kopii použijte samostatně připravený profil. Obnovit lze pouze operace zahrnuté v této kopii. Nezávislý soubor na disku proto uchovávejte odděleně a bezpečně.

## Generálka na notebooku a projektoru

V systému Windows zvolte **Win + P → Rozšířit**. Přetáhněte na druhou obrazovku jen okno otevřené tlačítkem **Otevřít offline projektor** a přepněte ho na celou obrazovku. Moderování a heslo ponechte na notebooku. Vyzkoušejte otázkový zvuk z moderování, video a zvuk rekapitulace z projektoru; zkontrolujte skutečný výstup do sálu.

Použijte syntetickou akci. Po přípravě ověřte, že máte přenositelný soubor i heslo, odpojte připojení a emulátory, úplně vypněte Chrome a restartujte notebook. Spusťte dříve nainstalovanou aplikaci bez připojení. Odhalte jednu odpověď, uložte zkušební body, zavřete projektor a znovu ho otevřete. Po druhém odemčení zkontrolujte poslední potvrzené body, uložte nouzovou kopii a po návratu testovacího backendu zkontrolujte náhled a potvrzení synchronizace. Zapište model notebooku, Chrome, výstup obrazu a zvuku a případný přesný krok, který selhal.

## Lokální ověření vývoje

Povinná místní brána `pnpm check:offline` běží na Windows. Použijte Node 22, nastavte Javu 21 přes `JAVA_HOME` a podle potřeby zadejte absolutní místní cesty `PLAYWRIGHT_EXECUTABLE_PATH` a `OFFLINE_QA_FFMPEG_PATH`. Binární soubory demo emulátorů musí být v jejich běžné místní mezipaměti. Použijte demo hodnoty z `apps/web/.env.example`. Brána zahrnuje sestavení, jednotkové testy, pravidla Firestore a Storage, skutečné nahrání vlastních médií, celý večer s vypnutými službami, odolnost, kapacitu a místní zkoušku tří variant Hostingu. Připravená úloha pro vzdálené CI používá `pnpm check:offline:core` bez měření paměti ve Windows. Běžný cloudový build offline soubory přidává až po výslovném nastavení popsaném v plánu vydání.

## Výsledky předchozí místní akceptace

Ve Windows a Chromium 151.0.7922.34 prošel jeden celý prohlížečový večer s přenosným souborem o 286 780 bajtech. Na druhém profilu se online ověřil jen podpisový klíč. Auth, Firestore, Functions, Storage i Hosting byly během večera skutečně vypnuté. Deset týmů odehrálo dvě kola; každý tým skončil s 11 body na děleném prvním místě. Zobrazily se průběžné i konečné výsledky na stranách po 6 a 4 řádcích. Po úplném zavření Chrome a opětovném otevření se potvrdila stejná otázka, stejné body a historie. Skutečné nativní přehrávání prošlo pro PNG, JPEG, WebP, MP3, WAV a MP4.

Samostatně prošla také rekapitulace s otázkovým zvukem pouze v projektoru a opětovné otevření projektoru bez změny potvrzeného průběhu.

Po skutečném obnovení demo Firebase a novém přihlášení přerušení před doručením nezapsalo nic. Po ztraceném potvrzení už provedeného zápisu opakování vrátilo existující výsledek: 20 bodovacích záznamů, 20 změn v historii a jedna výsledková verze. Souběžnou změnu online test ověřil samostatně: novější hodnota se bez výslovného rozhodnutí nepřepíše.

Kapacitní kvíz měl 148 snímků, 233 obrázků, dvě audia a 21 videí. Syntetické zadání odkazovalo před uzamčením na všech 256 souborů; běžné nahrávání v editoru prošlo samostatným testem. K ověření limitu byly vlastní pětisekundové MP4 doplněné platnými bloky výplně; nejde o zkoušku složitých 4K videí. Celkových 536 870 912 bajtů médií vytvořilo přenosný soubor o 537 141 543 bajtech. Varianta s jedním bajtem navíc byla odmítnuta bez souboru a bez připravené relace. Limit 512 MiB je součet médií; hlavička, metadata a šifrování přidávají režii. Editor může počet snímků omezit dříve podle počtu otázek a potřebných databázových zápisů.

| Měření na Windows s místními emulátory | Vzorků | Medián | p95 | Maximum | Selhání |
| --- | ---: | ---: | ---: | ---: | ---: |
| Příprava do potvrzeného stavu | 1 | 82,67 s | — | — | 0 |
| Studený import kapacitního souboru | 1 | 6,01 s | — | — | 0 |
| Výběr snímku → skutečný obrázek (otázka i pozadí) | 230 | 40,2 ms | 59,3 ms | 79,2 ms | 0 |
| Výběr snímku → pozorovaný snímek videa | 27 | 493,2 ms | 519,8 ms | 523,4 ms | 0 |
| Přehrát → pozorovaný snímek videa | 27 | 450,6 ms | 467,7 ms | 478,7 ms | 0 |

Stažení připraveného souboru trvalo 1,04 s, nouzový export 7,03 s a import nouzového souboru do samostatně připraveného profilu 5,95 s. Celkem 230 obrazových vzorků pochází ze 115 přepnutí; 27 měření videa zahrnuje 21 videí a 6 opakování. Časy zahrnují práci automatizace a čekání na skutečné dekódování. Nejde o měření prvního snímku na fyzickém projektoru. Jednosekundové vzorkování procesů Chrome ukázalo nejvýše 1 130,0 MiB pracovní sady při přípravě, 1 287,1 MiB během hraní a obnovy a 903,0 MiB při samostatné obnově. Součet může zahrnout sdílené stránky vícekrát a neobsahuje procesy emulátorů; není to požadavek na celkovou RAM notebooku.

Testy odolnosti prošly v pěti samostatných kopiích profilu: simulovaný nedostatek prostoru v odhadu prohlížeče, skutečné přerušení transakce, poškození šifrovaného žurnálu, vypršení oprávnění a chybějící mediální záznam. Aplikace neoznačila nepřipravený stav za funkční a při skutečném přerušení zachovala potvrzené body. Fyzicky plný disk ani výpadek napájení se nevyvolávaly.

Prošlo původních 48 scénářů včetně skutečného exportu a obnovy dokončené akce, 33 dosavadních prohlížečových regresí zálohy médií a předakční zkoušky, 1 604 jednotkových testů, 68 základních a 11 přístupových pravidel. Výsledek nezávisle kontrolovali QA a SECURITY. Aplikační oprava nativního přehrávače je v `d305e5f`, úplný core s přihlášením a synchronizací v `f5f9b7c`. Vše proběhlo lokálně se syntetickými daty.

Závěrečná povinná místní brána ze skriptů v repozitáři prošla na commitu `c4c1367`.
