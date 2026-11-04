# Zálohování a obnova JustKvízu — návrh k rozhodnutí

Stav: PROPOSED, cloudová konfigurace ani placené služby nejsou aktivované. Model a veřejná dokumentace ověřeny 4. 11. 2026; žádná inventura živého projektu nebyla provedena. Připravený zdroj není dokladem existence záloh.

## Doporučení a dvě varianty

Pro malé pořádané akce doporučujeme variantu A. Zálohu před každou významnou změnou a před večerem kontroluje provozovatel. Změny během posledních hodin může být po obnově nutné zadat znovu. PITR ve variantě B dává smysl, pokud vlastník chce omezit právě tuto ztrátu; při malé databázi je levné, ale samo neobnoví média ani běžící večer.

| Oblast | A — jednoduchá | B — kratší ztráta změn |
| --- | --- | --- |
| Firestore | denně, uchovat 7 dnů; týdně, uchovat 4 týdny | stejné denní zálohy; týdenní 14 týdnů; PITR zapnuté |
| Cloud Storage | soft delete 7 dnů; nezávislá kopie potřebných médií a manifest | soft delete 30 dnů; stejná nezávislá kopie |
| Drive | kopie originálních bajtů importovaných souborů + manifest alespoň před významnou změnou a po nové sadě médií | totéž; kontrola dostupnosti a hashů před každým večerem |
| Očekávaná ztráta změn | od posledního úspěšného checkpointu; běžně zhruba den, schedule není přesný čas | PITR umožní vybrat minutu v dostupné historii do 7 dnů; není to nulová ztráta |
| Cíl obnovy | pracovní cíl 4 hodiny až 1 pracovní den | pracovní cíl 1–4 hodiny při dostupném operátorovi |

Časy obnovy jsou cíle k ověření generálkou, nikoliv změřené SLA. Schedules umějí jednu denní a jednu týdenní zálohu, retenci do 14 týdnů a neumožňují určit přesnou denní hodinu. Restore vytváří novou databázi. [Oficiální zálohy Firestore](https://docs.cloud.google.com/firestore/native/docs/backups).

PITR ukládá historii až po aktivaci, s minutovou granularitou; maximální historie je 7 dnů. [PITR](https://docs.cloud.google.com/firestore/native/docs/pitr).

## Co musí tvořit jeden obnovitelný celek

Firestore je autoritou pro kvízy, jejich soukromé snímky, akce, registrace, skóre/historie a potvrzené výsledky. Firestore backup nekryje Firebase Auth, Storage, Drive, secret keyring, nastavení Functions ani Hosting. Pravidla a potřebnou konfiguraci drží konkrétní reviewed Git release; hesla, OAuth a šifrovací klíče nepatří do veřejného manifestu ani Git.

Manifest jedné zálohy musí soukromě obsahovat čas a zdroj, dokončený stav exportu/backup, Git verzi a konfiguraci, počty dokumentů a vazby, seznam media asset ID/backendů, velikosti a SHA-256, Storage object name/generation nebo Drive file/account binding. Neobsahuje výpis odpovědí, kontakty ani raw tokeny v provozním reportu. Samotná záloha obsahuje osobní a soukromá data: přístup omezit, kopii šifrovat, klíč uchovat odděleně a retenci sladit s rozhodnutím o osobních údajích. Staré právoplatně smazané osoby po obnově znovu odstranit podle odděleného záznamu požadavků.

Auth účty a aktuální členství se při obnově akce nevracejí do historického oprávnění. Plná katastrofická obnova potřebuje vlastní schválený plán pro Auth a secret keyring; obnovená databáze sama neobnoví účet ani přístup k Drive. Klíče musí zůstat přístupné pro dešifrování starých obálek, avšak e-mailové doručování se v obnovovaném prostředí nepovoluje automaticky.

## Média: ochrana bajtů a funkční vazby jsou dva kroky

Aplikace používá Drive pro připravené video/audio, historické Storage assety a ověřené původní URL obrázků. Záloha pouze Storage proto nestačí. Původní externí URL nejsou pod kontrolou platformy; původní vlastní/licencované soubory a oprávněně uložené záložní bajty uchovat s manifestem. Bez oprávnění nic automaticky nestahovat.

Drive koš dovoluje obnovit soubor před automatickým odstraněním po 30 dnech. Trvalé smazání je jiný případ. [Drive trash/delete](https://developers.google.com/workspace/drive/api/guides/delete). Revize souborů mohou být automaticky odstraněny a nejsou náhradou samostatné kopie. [Drive revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions).

Gateway ověřuje Drive file/account binding, MIME/size a hash. Kopie s novým file ID není automaticky kompatibilní s immutable asset metadata. Storage gateway v `functions/src/media/endpoint.ts` čte konkrétní generation. Soft-delete restore vytvoří novou verzi objektu, a proto ochrana bajtů sama nedokládá funkční přehrávání po obnově. [Cloud Storage soft delete](https://docs.cloud.google.com/storage/docs/soft-delete).

Při zachovaném původním Drive ID obnovit soubor z koše a ověřit vazbu i obsah. Po ztrátě Drive ID nebo původní Storage generace STOP pro automatický návrat do provozu: potřebná je konkrétní zkontrolovaná oprava vazby se stejnými bajty, novými validovanými metadaty a regrese soukromého/veřejně odhaleného přehrávání. Neprovádět hromadné přepisování snímků ani vypnutí kontroly generace. Tato cloudová funkční obnova je dosud neověřená. Object Versioning může zachovat neaktuální generaci, ale je nutné ověřit konkrétní přístup a řízenou retenci; nepřidávat ho k soft delete automaticky bez rozpočtu. [Object Versioning](https://docs.cloud.google.com/storage/docs/object-versioning).

## Postup obnovy jedné akce

1. Zaznamenat incident, požadovanou akci a čas; určit, zda stačí existující Koš → Obnovit akci. Tato uživatelská funkce není restore zálohy a nevrací starší skóre. Aktuální data a checkpoint zachovat.
2. Vybrat poslední bezpečný Firestore backup nebo čas PITR před incidentem. Schválená cloudová obnova míří do NOVÉ dočasné databáze ve stejném projektu a lokalitě, nikdy přes existující databázi. Počkat na dokončenou operaci. [Restore API](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/restore).
3. Před čtením aplikací ověřit deny-all/current Rules a IAM, nastavení TTL a nepřítomnost připojených doručovacích/importních workerů. Zálohy neobsahují Rules ani TTL. Bez nových IAM grantů a bez živých triggerů/e-mailů.
4. V izolaci zrekonstruovat přesnou množinu: `events/{id}` a jeho registrations, registrationNames, scores včetně history, scoreOperations, eventOperations; odkazované sessions včetně interimVersions/interimOperations/finalVersions/finalOperations; přesný `quizSnapshots/{id}` se slides/rounds a související soukromé mediaAssets/import provenance. Zkontrolovat event/session/snapshot vazby, vlastnictví a sdílené odkazy. Zachovat přesný soukromý finalReveal.versionId; nevybírat nejnovější verzi odhadem.
5. Do pracovní obnovy automaticky nepřenášet aktivní emailIntents/emailSecrets/campaign workers, refereeAccess, OAuth, memberships, capability credentials ani veřejně odhalené publicSessions. Audit/účtenky ponechat jako soukromý doklad; replay historických příkazů není metoda obnovy. Přesná transformace capabilityVersion a nových odkazů vyžaduje samostatně reviewovaný plán, aby nešlo o obnovení odvolaného oprávnění.
6. Porovnat týmové počty, kapacity, idempotentní účtenky, skóre a historii, potvrzenou finální verzi a hash všech potřebných médií. V lokálním demo prostředí ověřit čtení, čerstvé přihlášení, pokračování skóre s novou revizí a odmítnutí staré; správné odpovědi nesmějí před reveal na projektor. Ověřit, že jiná akce není dotčena.
7. Připravit přesný rozdíl dokumentů, kontrolu novějších legitimních změn a rollback checkpoint. Copy-back do živé DB, změna odkazů, obnovení registrací a publikace jsou samostatný zásah vyžadující konkrétní schválení vlastníka. Selektivní live restore nástroj zatím není certifikovaný; neslibovat jednoklikovou obnovu.

## Celá databáze a změna aplikace

Pro celou DB se opakují kroky 1–3 a kontroly všech vazeb. Web/Functions dnes používají běžnou databázi; vytvoření nové named DB samo nepřepne aplikaci. Návrat do provozu vyžaduje konkrétní reviewed cutover plán včetně testů Rules, Auth, Storage/Drive, outboxu a aktuálních oprávnění. Starou DB nemažeme ani neprovádíme destruktivní přejmenování. Cloud restore/cutover je approval gate.

Před významnou změnou uložit přesný release/build, Rules/index/config a dokončený datový checkpoint plus media manifest. Denní záloha s neurčenou hodinou nemůže být prohlášena za okamžitý pre-release checkpoint. Podle schváleného rozsahu použít dokončený managed export nebo PITR checkpoint; export má vlastní read/storage náklady. [Managed export/import](https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import). Před exportem a po něm ověřit konzistentní vazby; běžný export neprohlašovat automaticky za atomický společný snapshot více služeb.

## Měsíční náklady — transparentní model

Skutečná DB/bucket lokalita, objem, Drive tarif a nynější retence nebyly čteny. Níže je výpočtový příklad v USD bez DPH a bez směnného kurzu pro výchozí zveřejněný **Iowa (us-central1)** tarif, nikoli cenová nabídka pro evropský runtime. Region Functions `europe-west1` nedokládá lokalitu databáze. Před schválením aktivace doplnit skutečné SKU/lokalitu a objemy.

Z aktuální rate card: backup přibližně 0,03 USD/GiB-měsíc, PITR přibližně 0,15 USD/GiB-měsíc a restore 0,20 USD/GiB. Přepočet hodinových cen používá 730 h/měsíc. [Firestore pricing](https://cloud.google.com/firestore/pricing?hl=en). Standard kopie médií přibližně 0,02 USD/GiB-měsíc ve stejném referenčním regionu; noncurrent i soft-deleted bajty jsou také placené, operace a síť zvlášť. [Storage pricing](https://cloud.google.com/storage/pricing).

| Model 1 GiB Firestore + 10 GiB nezávislé kopie médií | A | B |
| --- | --- | --- |
| Průměrné plné DB kopie ve stabilním stavu | 7 denních + 4 týdenní = 11 GiB | 7 denních + 14 týdenních = 21 GiB |
| DB backups/měsíc | 0,33 USD | 0,63 USD |
| PITR/měsíc | 0 | 0,15 USD |
| 10 GiB media kopie/měsíc | 0,20 USD | 0,20 USD |
| Součet modelu před přenosy/operacemi/změnami | **0,53 USD/měsíc** | **0,98 USD/měsíc** |

Retained soft-delete navíc = průměrné smazané GiB/den × počet dnů retence × media sazba. Při 0,1 GiB/den je to dalších 0,014 USD pro A nebo 0,06 USD pro B. Historie změn/nezávislé full kopie může být výrazně větší než aktuálních 10 GiB; dopočítat skutečný počet kopií. Jeden 1 GiB restore je v referenčním modelu 0,20 USD + dočasná DB a reads/writes/egress. Přenos celé 10 GiB kopie mimo cloud či mezi regiony a Drive případný tarif se účtují zvlášť. Vlastní provoz aplikace a cena práce nejsou v součtu. Toto jsou malé technické náklady, ale bez skutečných vstupů je nelze slíbit jako skutečný účet.

## Lokální ověření bez duplikace nástrojů

Používá se stávající `tools/event-night/restart-acceptance.mjs` a `docs/EVENT_NIGHT_RESTART_ACCEPTANCE.md`: syntetický demo export Auth/Firestore/Storage, zastavení, nový import, kontrola bajtů a identity, pokračování revisioned scoringu, stale-CAS denial a skutečné přerušení mezi přejmenováními snapshotů. Příkazy po připravení Node 22/Java a závislostí:

```powershell
pnpm --filter @filmovy-kviz/functions... build
node --test tools/event-night/restart-acceptance.test.mjs
node tools/event-night/restart-acceptance.mjs --powershell C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

Hodnotí se pouze nový `SYNTHETIC_EVENT_NIGHT_RESTART_RECOVERY_PASS` receipt s přesnými source/build hashy. Existence nástroje ani historický PASS nejsou aktuální test. Harness nedokládá managed cloud restore, Drive/novou Storage generation, selektivní live copy-back, OS power-loss ani fyzický večer. Konkrétní výsledek posledního ověření vede interní release evidence.

## Konkrétní schválení před aktivací

Vlastník volí A nebo B a přípustnou retenci osobních údajů. Poté samostatně schválí přesnou projektovou/DB/bucket identitu, zjištěný region a objem, přepočtený měsíční rozpočet, uložiště šifrované media kopie, jejího správce a izolovanou zkušební cloud obnovu. Žádné nové IAM, placená konfigurace ani copy-back se tímto návrhem neprovádějí.
