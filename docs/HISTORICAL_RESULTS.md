# Historické konečné výsledky

Po dokončení akce je na jejím detailu odkaz **Otevřít konečné výsledky** na
`/admin/events/:eventId/results`. Obrazovka ukazuje potvrzené umístění, název
týmu a body, stav Dokončeno a čas ukončení, pokud session obsahuje `endedAt`.
Je pouze pro čtení; neobsahuje editaci, publikaci, fanfáru ani obnovení session.
Pro live/ready/finalizing akci odkaz nevzniká a přímá historická URL odkazuje
zpět na detail bez použití live příkazů.

## Autorita

Jedinou autoritou je immutable dokument
`sessions/{event.liveSessionId}/finalVersions/{session.finalReveal.versionId}`.
Vzniká existujícím `controlFinalReveal` při výslovném start/replace a již obsahuje
schválené `rank/teamName/halfPoints`. `finalOperations` jsou auditní/idempotentní
potvrzení příkazů, nikoli jiný výpočet výsledků; historická obrazovka je nečte.
Standardní END ponechává pointer a skryje veřejný výstup. Nová cesta nemění
writer, scoring, snapshot ani tento lifecycle.

Oprava B11 z 3. 11. 2026 přenáší původní lokální opravu uzavírání relací:
`completeEvent` zachová přesný soukromý `finalReveal.versionId` a nastaví
`visible: false`, i když relace již skončila. Veřejná projekce zůstává ukončená
bez výsledků a odpovědí. Stejný dokončovací request vrací původní receipt bez
dalších zápisů; změněný replay, zastaralá revize a nové dokončení již dokončené
akce se odmítají. Chybějící pointer se neodhaduje ani zpětně nedoplňuje.

Repository nejprve načte akci stávajícím scoped `getEvent` a pak dvěma
`getDocFromServer` konkrétní session a verzi. Vyžaduje completed akci, ended
session, správnou vazbu event/session/snapshot a přesné versionId. Nevybírá
„nejnovější“ dokument podle času a při chybějícím pointeru nic neodhaduje.
Zobrazuje uložené pořadí bez nového řazení/přepočtu; půlbody jen formátuje česky.

Názvy týmů pocházejí rovněž z potvrzené verze. Pozdější přejmenování nebo
chybějící registrace výsledek nemění. Chybějící jméno přímo v uloženém řádku,
neplatné body, prázdná tabulka, chybějící verze nebo nesouhlas vazeb znamenají
„Konečné výsledky této akce nejsou k dispozici.“ Nevznikají náhradní výsledky.

Rozpad po kolech se nyní nezobrazuje: potvrzená verze ukládá kumulativní řádky,
nikoli schválenou matici tým/kolo. Aktuální scores nebo knihovní kvíz nejsou
náhradní historickou autoritou. Tím zůstává stabilní i generálka se zdrojovou
revizí 30→31 a snapshotem revize 30.

Uzavření při complete/cancel/trash zachovává soukromý potvrzený pointer.
Samostatná existující cesta restore stále může odstranit vazbu
`event.liveSessionId`; její rozpracovaná oprava není součástí B11 integrace.
Při chybějící vazbě se bezpečně zobrazí nedostupný stav a nic se neobnovuje
výběrem jiné verze z auditní historie.

## Oprávnění a nasazení

Použije se současné `event.read` a scope akce. Route gate je navigační ochrana;
scoped API a stávající Firestore Rules nezávisle vynucují aktuální členství,
scope a viditelnost akce. Žádná nová serverová funkce, Rules, index ani permission.
Přímé zápisy do verze, session, výsledků i veřejné projekce zůstávají zakázané.
Používají se serverová čtení, ne offline cache. AuthProvider při změně identity
či verze členství remountuje privátní pohled; opožděná odpověď opuštěné stránky
se zahodí. Síťové chyby umožní opakovat pouze čtení, zamítnutí přístupu má vlastní text.

Případné budoucí nasazení vyžaduje samostatný souhlas a pouze webový build.
Tato implementace nic nenasazuje ani nezapisuje do cloudové QA akce.

## Cílené ověření

- `tests/historicalResults.test.ts`: autorita, vazby, chybějící/malformed verze,
  odstraněný tým, pozdější knihovna/skóre, opakované čtení a completed/live rozdíl.
- `tests/historicalResultsUi.test.tsx`: pořadí/půlbody, read-only ovládání,
  loading, chyby, retry, permission gate a opožděná odpověď jiné akce.
- `tests/firestore.rules.test.ts`: scope čtenáře jen s event.read, cizí scope,
  chybějící permission, odebrané členství, trash, anonymous a zákaz všech zápisů.
- `tests/browser/historical-results.config.ts`: skutečné lokální emulátory,
  dokončení přes existující final reveal callables, detail → výsledky, mobil,
  reload, pozdější změna knihovny a odstranění registrace, odebrání scope,
  chybějící finále. Porovnává session, event, scores, versions, operations
  i public projection před a po čtení. Fixture odmítá non-demo a nelokální hosty;
  browser blokuje nelokální síť.

CI přidává přesně base `codex/justkviz-ui-cleanup-01` do existujícího PR triggeru
a emulátorový browser krok. Nemění oprávnění workflow, nepřidává secrets ani deploy.
