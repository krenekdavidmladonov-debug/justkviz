# Interní bodování akce

V detailu akce otevřete **Bodování → Otevřít bodování**, vyberte kolo, zadejte
body všem týmům a stiskněte jediné **Uložit body celého kola**. Mobilní rozhodčí
používá stejný postup. Autosave není. Přijímá se desetinná čárka i tečka a půlbody.
Nula je uložený výsledek; prázdné pole je nezadáno a nemaže uložené body.
První zápis důvod nevyžaduje. Oprava a výslovné **Vrátit na nezadáno** vyžadují
vlastní důvod u týmu (1–300 znaků po oříznutí). Vrácení se potvrzuje při uložení.
Historie zůstává zachována; zrušené týmy jsou pouze ke čtení.

Přepnutí kola a odchod chrání rozepsané hodnoty. Příchozí aktualizace je nepřepíší.
Během odesílání se kolo nepřepíná. Konflikt jediného týmu odmítne celé uložení;
žádné body tohoto požadavku se nezapíší. **Připravit opravu aktuální revize**
vyžaduje výslovné rozhodnutí a následné uložení. Po chybě zůstává vstup i stejné
requestId pro bezpečné opakování. Samotné příchozí skóre nenahrazuje potvrzenou
odpověď. Potvrzená odpověď okamžitě zobrazí uložené hodnoty bez dalšího čekání
na pětisekundové načtení; starší rozpracované čtení ji nesmí přepsat.

## Datový kontrakt

- Tým je přijatá kanonická `events/{eventId}/registrations/{teamId}`.
- Kolo je existující `quizSnapshots/{snapshotId}/rounds/{roundId}` z aktuálního
  `event.quizAssignment.snapshotId`. První zápis nastaví `scoring.started = true`
  a zvýší revizi akce. Existující ochrana relocku zakáže následnou změnu snapshotu.
- `events/{eventId}/scores/{scoreId}` zachovává SHA-256 JSON `[teamId, roundId]`
  a pole `teamId, roundId, snapshotId, halfPoints, revision, updatedAt` a aktéra.
- `halfPoints` je bezpečné celé nezáporné číslo nebo `null` pro nezadáno. Nula
  zůstává výsledkem. Převod desetinných číslic přes BigInt nezakulacuje zlomky.
- Chybějící skóre má revizi 0; každá změna přidá 1. Vymazání uchová dokument s
  `null` a pokračující revizí. Nezměněná hodnota není novým zápisem.
- `scores/{scoreId}/history/{revision}` zůstává samostatná historie každého týmu:
  revize, původní/nová hodnota, aktér, serverový čas a důvod. Staff používá
  `actorUid`; rozhodčí `actorAccessId` a serverový `actorLabel`.
- Existující serverová `scoreOperations` uchovává fingerprint normalizovaného
  požadavku, odpověď, aktéra a čas. Starý jednotlivý klíč zůstává
  `[actorKey, eventId, "saveEventScore", requestId]`, společný klíč kola je
  `[actorKey, eventId, "saveEventRoundScores", requestId]`. Nejde o nový endpoint.

Existující `saveEventScore` přijímá také striktní tvar:
`{ eventId, snapshotId, roundId, requestId, scores: [{ teamId, expectedRevision,
halfPoints, reason }] }`. Původní jednotlivý tvar je zachován. Pole obsahuje
pouze změněné týmy (1–200), každý jednou. Server řadí podle ID pro stabilní
fingerprint při změně pořadí vstupu. Limit drží dvě operace na tým a společnou
účtenku pod limitem transakčních zápisů Firestore. Více než 200 změněných týmů
UI odmítne s vysvětlením. Nezměněné a dosud nevyplněné řádky se nezapisují.

Server ověří současný snapshot, kolo, všechny registrace a revize, pak zapíše
všechny výsledky, historie a jednu účtenku v jediné transakci. Konfliktní odpověď
obsahuje jen ID, revizi a body konfliktních týmů. Stejný requestId s jiným obsahem
je odmítnut. Účtenka předchází kontrole revize, takže retry po pozdější opravě
potvrdí původní historickou operaci bez nových zápisů. Oprávnění se ověřuje i při retry.

## Oprávnění a zveřejnění

Staff vyžaduje aktuální ověřený Auth profil, aktivní serverovou členskou
příslušnost, `event.score` a rozsah konkrétní akce. Oprávnění se znovu ověřují
uvnitř každé transakce. Role a historické claims samy nic nepovolují.
Rozhodčí používá stávající `saveRefereeScore`, stejné `credential` a `score`
obsahující tvar společného zápisu výše. Kontroluje se platnost capability,
aktuální oprávnění vydavatele a případně přihlášeného držitele; viz REFEREE_ACCESS.md.
Zápis je možný jen v provozní akci ready/live/finalizing.

Rules povolují čtení skóre/historie aktuálním aktivním členům s `event.read`,
rozsahem a viditelností konkrétní akce. Přímé zápisy jsou zakázány všem klientům;
účtenky jsou server-only. Registrační token scoring nepovoluje. Bodování nečte
kontakty, otázky ani správné odpovědi a nezapisuje do publicEvents/publicSessions.
Výsledky zveřejňuje moderátor samostatně. Nové kolekce, Rules ani indexy nevznikají.

## Ověření a rozsah nasazení

Jednotkové testy `eventScoring.test.ts` ověřují přesné půlbody, striktní batch,
atomické odmítnutí, historie a normalizované retry. `refereeWorkflow.test.tsx`
ověřuje všechna družstva v kole, jediné uložení, okamžité potvrzení, konflikty,
ztracenou odpověď, ochranu navigace, offline a revokaci. Existující jednotlivé
ScoreRow testy dál chrání zpětnou kompatibilitu.

`tests/e2e/event-scoring-emulator.mjs` a `referee-access-emulator.mjs` používají
skutečné Auth/Firestore/Functions emulátory a přidávají společný zápis i kontrolu
oprávnění před retry. Wrapper fail-closed vyžaduje demo-* a lokální endpointy.
Po změně běží `pnpm check`, cílené testy a `pnpm test:rules`. Samotné testy nic
nenasazují. Release vyžaduje jen existující `saveEventScore`, `saveRefereeScore`
a Hosting; žádná nová invoker oprávnění. V1 zůstává mimo rozsah.
