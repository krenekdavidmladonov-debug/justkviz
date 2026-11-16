# Zálohování a obnova při navýšení 0 Kč

Rozhodnutí: žádný PITR, účtované Firestore zálohy, nové tarify, produkční prostředky ani cloudové čtení/export/test s neprokázaným nulovým navýšením. Dřívější placené varianty A/B a modelové ceny nejsou vybrané ani aktivované. Bezplatná kvóta sama nedokládá nulovou cenu konkrétní operace.

## Co je doložené a co chybí

Existující lokální nástroje umějí syntetický demo export Auth/Firestore/Storage, zastavení, nový import, kontrolu totožnosti a pokračování bodování. Je to důkaz místního obnovovacího postupu. Skutečné produkční zálohy, jejich nezávislá kopie ani cloudová obnova nebyly ověřeny: **BLOCKED / NO-GO pro ochranu živých dat**. Žádný skutečný produkční kontakt ani kvíz se tímto postupem neexportuje.

Git chrání schválený zdroj a konfiguraci; není zálohou registrací, výsledků, médií, účtů ani tajných klíčů. GitHub repozitář nesmí obsahovat osobní údaje nebo soukromé exporty.

| Oblast | Co je doložené | Co ověřit před obnovou živé služby |
|---|---|---|
| Firestore | Demo export a import, otázky a připnutý snapshot, registrace, body a výsledkové verze v oddělených zkouškách | Poslední skutečný úspěšný běh, rozsah kolekcí a indexů, frekvence, retence a dostupný bod obnovy |
| Storage a Drive | Demo export Storage a shoda bajtů po obnově. Oprávnění Drive ani kopie jeho živých médií nejsou ověřené | Ověřit zvlášť nastavení jednotlivých bucketů a Drive, nezávislou kopii a funkční vazbu snapshotu na ID a generaci |
| Auth a oprávnění | Demo návrat účtu a členství, přihlášení a autorizované pokračování bodování | Ověřit poskytovatele přihlášení, UID a členství. Před zpřístupněním porovnat s aktuálními odvoláními a případnými výmazy |
| Konfigurace | Git a soukromá evidence vydání | Zapsat revize, projekt, regiony, pravidla, indexy, identity a názvy vazeb na klíče. Postup obnovy klíčů držet odděleně od exportu |

Pro živé služby je skutečný stav automatických záloh, frekvence, retence a účtování **neověřený**. Firestore umí denní nebo týdenní plánované zálohy s retencí do 14 týdnů. PITR dovoluje návrat v okně do sedmi dnů po jeho postupném naplnění a účtuje úložiště i čtení při obnově. Plánované zálohy a jejich obnovení mají vlastní účtování. Soft delete ve Storage závisí na nastavení bucketu, má omezené okno a nechrání Auth, Firestore ani Drive. [Plánované zálohy](https://firebase.google.com/docs/firestore/backups) · [PITR](https://firebase.google.com/docs/firestore/pitr) · [Účtování Firestore](https://firebase.google.com/docs/firestore/pricing) · [Soft delete ve Storage](https://docs.cloud.google.com/storage/docs/soft-delete)

## Jednoduchý postup pro vlastníka

1. Před akcí ověřit existenci již dostupné zálohy: datum, co obsahuje, kde je nezávislá kopie a kdo ji smí obnovit. Pokud žádná taková kopie není doložená, neslibovat chráněná data. Nezapínat placenou službu.
2. Již existující chráněné lokální kopie uchovat beze změny originálu. Kvízy/registrace/výsledky skutečné produkce nezískávat novým cloudovým exportem bez samostatného oprávnění k datům a důkazu nulových nákladů. Stahování z cloudu může být účtované.
3. Pro oprávněně již dostupnou kopii použít pouze již vlastněné nezávislé úložiště (například existující externí disk). Před kopírováním skutečných údajů musí být ověřené šifrování, přístup a obnova; jeho dostupnost v konkrétním systému nepředpokládáme. Bez existujícího ověřeného šifrování stav BLOCKED; nic nekupovat a nekopírovat citlivá data do nechráněného místa.
4. Klíč nebo obnovovací údaj držet odděleně od kopie, ne v chatu/Git. Určit hlavního a záložního správce. Před kopírováním/po něm ověřit počty souborů a kontrolní součty; změněná kopie není ověřená záloha.
5. Obnovu cvičit nejprve na syntetických datech v novém demo prostředí. Produkční data nepřepisovat. Papírové archy a průběžné poznámky při večeru pomáhají ručně rekonstruovat body, nenahrazují zálohu celé aplikace.

## Úplnost dat a média

Jedna akce zahrnuje event, registrace/rezervace názvů/operation receipts/rate budgety, skóre a historii, přesný snapshot a potvrzené výsledkové verze. Při obnově nelze vrátit stará oprávnění, odvolané správní odkazy, vyčerpaný limit či znovu odeslat outbox. Oddělit osobní kontakty od historie výsledků a respektovat již vyřízené výmazy.

Firestore kopie neobsahuje Firebase Auth, Storage, Drive média a obnovovací klíče. Drive video/audio potřebují původní file ID/account vazbu; kopie bajtů s novým ID sama nezajistí přehrávání. Storage používá připnuté generation, obnovená nová generace může vyžadovat konkrétní bezpečnou opravu vazeb. Externí obrázkové URL mohou přestat fungovat. Neprovádět hromadné přepisování snapshotů ani vypnutí ověřování.

Obnova jedné akce i celé aplikace musí nejprve v izolaci ověřit tato propojení, kontaktní soukromí, skóre, kapacity a média. Skutečný cloud restore/copy-back, Auth/secret disaster recovery a placené služby nejsou povolené ani ověřené. Účty/klíče nelze nahradit samotným databázovým exportem.

Pro první provozní rozhodnutí stačí potvrdit inventář bez exportu z projektu V2. Správce v konzoli ověří databázi, existující plány a poslední úspěch, stav PITR, retenci bucketů a dostupnou chráněnou kopii. Zaznamená datum, rozsah a odhad velikosti, bez jmen účastníků a bez obsahu dokumentů. Pokud krytí chybí, nejdřív posoudit už dostupné šifrované úložiště. Schválení placené varianty by muselo určit cílový projekt a izolované místo obnovy, rozsah dat a médií, frekvenci, retenci, přístup a strop pro úložiště, čtení, obnovu i přenos. Bez těchto údajů nelze odhadnout skutečné náklady.

## Bezplatná lokální zkouška na syntetických datech

Použít již instalovaný Node22/Java a existující závislosti. Nástroj vytváří vlastní demo-restart-* projekt pouze v místních emulátorech, odděluje CLI konfiguraci a odmítá síť mimo loopback:

```powershell
node --test tools/event-night/restart-acceptance.test.mjs
node tools/event-night/restart-acceptance.mjs --powershell C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

Přesný úspěšný receipt a source/build hash patří do soukromé evidence. Obnova dokončené akce navíc porovnává skutečný export/import stejného syntetického večera. Ani jeden test nedokládá zálohování reálné produkce, obnovu Drive médií nebo fyzickou odolnost proti výpadku disku.

**Zbývající riziko:** bez doložené současné zálohy skutečných dat nelze při 0 Kč tvrdit bezpečnou produkční obnovu. Pokračovat ostatní bezplatnou prací; případný konflikt s bezpečným vydáním ponechat NO-GO, ne automaticky objednat zálohy.
