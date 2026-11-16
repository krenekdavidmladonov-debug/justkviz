# Mazání kvízů z knihovny

V knihovně `/admin/quizzes` má každý spravovatelný kvíz trvale viditelné tlačítko **Smazat** s košem, vedle otevření a úpravy. Ovládání zůstává dostupné i na mobilu. Dialog uvádí skutečný název; výchozí fokus má Zrušit. Během požadavku nelze potvrzení odeslat opakovaně.

Úspěšná odpověď ihned přesune položku mezi přehledy **Knihovna / Koš** a zobrazí potvrzení. Obnovit vrátí stejný kvíz se stejným obsahem a ID. Chyba ponechá položku v aktuálním přehledu a zobrazí důvod. Trvalé mazání ani automatické vyprazdňování koše není součástí této změny.

## Existující hranice a data

Původní backend uměl odstranit slide či kolo, nikoli celý kvíz. Koš akcí má jiný životní cyklus a nelze jej použít pro kvízy. Dvě malé operace `trashQuiz` a `restoreQuiz` proto používají stávající zabezpečené callable Functions a Firestore transakce, bez nové kolekce.

Koš je nezávislá vlastnost kořenového dokumentu kvízu: `disposition: active | trash`; chybějící hodnota znamená active. Původní `status: draft | ready | archived` se nemění. Přechod zvýší `revision`, zapíše důvěryhodné `updatedAt/updatedBy` a `trashedAt/trashedBy` nebo `restoredAt/restoredBy`. Obnova odstraní aktuální příznaky trashedAt/trashedBy. `expectedRevision` brání přepsání souběžné změny.

Obě operace vyžadují aktuální ověřenou identitu, aktivní členství, `quiz.read`, `quiz.delete` a rozsah konkrétního kvízu, znovu ověřené v transakci. Zobrazení tlačítka není bezpečnostní hranice. Přímé klientské zápisy zůstávají zakázané. Koš nemění práva ke čtení obsahu přes existující oprávněné detailní/surové čtení; nejde o nový stupeň utajení.

`readAccessData` pro seznam quizzes standardně koš vynechá; volba `includeTrash: true` vyžaduje `quiz.delete` a vrací jen kvízy v povoleném rozsahu. Existující výběry kvízů pro nové použití tak odstraněné položky nenabízejí. Editor, strukturální změny, nové nahrávání médií, nové zdrojové moderování a nové zamknutí kvízu pro akci ověřují aktivní stav i v transakci. Před dalším použitím je třeba kvíz obnovit.

## Ochrana akcí a médií

Přesun kontroluje pouze relace tohoto kvízu: sessions.quizId a events.quizAssignment.quizId. Neukončené moderování bez snapshotu blokuje přesun. Navázaná akce potřebuje platnou úplnou uloženou kopii; kontroluje se identita snapshotu, revize, počty a uspořádání uložených slidů. Příliš mnoho vazeb (více než 100 sessions nebo akcí) nebo neúplná kopie operaci bezpečně zablokují. Chyba neprozrazuje názvy ani identifikátory akcí mimo oprávnění uživatele.

Akce s vlastní úplnou kopií mohou pokračovat. Přechod mění pouze kořen kvízu: žádný slide, kolo, otázku, mediální objekt, snapshot, výsledek, skóre, historii ani veřejnou projekci neupravuje ani nemaže. Starší ukončené zdrojové session mají původní obsah nadále uložený. Sdílená média a vazby ze snapshotů zůstávají zachované.

## Ověření a vydání

Změna se ověřuje cílenými testy pravidel, callable operací na čerstvých emulátorech s `demo-*` ID a prohlížečovým scénářem s lokálními syntetickými daty. Prohlížečový scénář pokrývá desktop i mobil, zrušení, dvojí odeslání, přesun, aktualizaci přehledu, obnovu a chybu serveru. Žádné skutečné kvízy se při ověření nemažou.

Příkazy: `pnpm check`, `pnpm test:rules`, `pnpm test:unit tests/quizTrash.test.ts tests/quizModel.test.ts tests/accessPermissions.test.ts`, `pnpm exec playwright test --config tests/browser/quiz-trash.config.ts` a `node tests/e2e/quiz-trash-emulator.mjs` s explicitními lokálními adresami emulátorů a demo projektem.

Nasazení vyžaduje samostatné schválení. Vedle Hostingu a nových callable operací je nutné nasadit upravený serverový seznam a všechny existující operace, které kontrolují aktivní kvíz. Žádná migrace obsahu, nové indexy, změna Rules ani čištění Storage nejsou potřeba.

Přesný rozsah Functions (22): `trashQuiz`, `restoreQuiz`, `readAccessData`, `updateQuizMetadata`, `updateQuizSlide`, `createQuizSlide`, `duplicateQuizSlide`, `moveQuizSlide`, `updateQuizRound`, `reorderQuizQuestion`, `moveQuizQuestionToRound`, `duplicateQuizRound`, `moveQuizRound`, `createQuizRound`, `deleteQuizSlide`, `removeQuizRound`, `repairQuizPreflightIssue`, `beginQuizMediaUpload`, `finalizeQuizMediaUpload`, `createLiveSession`, `lockEventQuiz`, `configureEventShow`. U poslední operace se blokuje pouze nové připojení média z kvízu v koši; existující připojení dál funguje. Backend je nutné vydat před novým webem. Cílem webu je nynější V2 Hosting `justkviz-v2`; samotný tento dokument žádné nasazení neschvaluje.

Výsledek 16. 10. 2026: `pnpm check` prošel, 26 cílených unit testů a 50 testů Rules prošlo. Osm skupin scénářů skutečných callable operací prošlo na novém `demo-quiz-trash-20261016`; související snapshoty, skóre/historie, media metadata i veřejné dokumenty zůstaly shodné. Šest prohlížečových scénářů prošlo při šířce 1440 i 390 px. Prohlížeč dostával skutečné komponenty a CSS se syntetickým transportem; ostatní síťové požadavky byly blokované. Po konečné úpravě testovacího prostředí prošel znovu TypeScript testů a cílený ESLint. Nasazení neproběhlo.
