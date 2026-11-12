# Zálohování a obnova při navýšení 0 Kč

Rozhodnutí: žádný PITR, účtované Firestore zálohy, nové tarify, produkční prostředky ani cloudové čtení/export/test s neprokázaným nulovým navýšením. Dřívější placené varianty A/B a modelové ceny nejsou vybrané ani aktivované. Bezplatná kvóta sama nedokládá nulovou cenu konkrétní operace.

## Co je doložené a co chybí

Existující lokální nástroje umějí syntetický demo export Auth/Firestore/Storage, zastavení, nový import, kontrolu totožnosti a pokračování bodování. Je to důkaz místního obnovovacího postupu. Skutečné produkční zálohy, jejich nezávislá kopie ani cloudová obnova nebyly ověřeny: **BLOCKED / NO-GO pro ochranu živých dat**. Žádný skutečný produkční kontakt ani kvíz se tímto postupem neexportuje.

Git chrání schválený zdroj a konfiguraci; není zálohou registrací, výsledků, médií, účtů ani tajných klíčů. GitHub repozitář nesmí obsahovat osobní údaje nebo soukromé exporty.

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

## Bezplatná lokální zkouška na syntetických datech

Použít již instalovaný Node22/Java a existující závislosti. Nástroj vytváří vlastní demo-restart-* projekt pouze v místních emulátorech, odděluje CLI konfiguraci a odmítá síť mimo loopback:

```powershell
node --test tools/event-night/restart-acceptance.test.mjs
node tools/event-night/restart-acceptance.mjs --powershell C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

Přesný úspěšný receipt a source/build hash patří do soukromé evidence. Obnova dokončené akce navíc porovnává skutečný export/import stejného syntetického večera. Ani jeden test nedokládá zálohování reálné produkce, obnovu Drive médií nebo fyzickou odolnost proti výpadku disku.

**Zbývající riziko:** bez doložené současné zálohy skutečných dat nelze při 0 Kč tvrdit bezpečnou produkční obnovu. Pokračovat ostatní bezplatnou prací; případný konflikt s bezpečným vydáním ponechat NO-GO, ne automaticky objednat zálohy.
