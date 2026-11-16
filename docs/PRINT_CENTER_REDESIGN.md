# Tisk a materiály

## Použití

Otevřít akci → **Tisk a materiály** → vybrat Hrací arch pro hráče, Bodovací tabulku, Hrací arch se správnými odpověďmi nebo samostatný Klíč správných odpovědí. Náhled a stažení používají stejný serverový PDF Blob. Hráčský arch se otevře přímo a stáhne přes **Stáhnout PDF**. Oba dokumenty s odpověďmi jsou v oddělené sekci pro obsluhu a vyžadují potvrzení **Otevřít dokument se správnými odpověďmi**; mají výrazné varování a jiné označení stažení. Akce nejprve musí mít připravený kvíz.

Sekce **Upravit vzhled a tisk** nabízí Standardní / Úsporný, barevný / černobílý tisk a volitelné archy pro přijaté týmy, jeden tým nebo prázdný arch. Standardní začíná každé kolo na novém archu. Úsporný nechává kola navazovat. Limity zůstávají 30 týmů v dávce, 200 fyzických stran a 10 MB. Bez týmů nebo při více než 30 týmech je výchozí prázdný arch. Bodovací tabulka vyžaduje přijaté týmy a uvádí jejich názvy, kola a celkový součet; nevytváří neexistující individuální seznam hráčů ani kontakty.

## Dva archy na jednom listu

Hráčské a organizační archy se sázejí přímo do dvou polovin A4 na šířku (297 × 210 mm). Každá polovina má 148,5 × 210 mm, tedy orientaci A5 na výšku. Dvě A5 na šířku by se vedle sebe na A4 na šířku nevešly. PDF obsahuje prostřední přerušované vodítko pro rozstřižení. Tisknout na A4, **100 % / skutečná velikost**, jednu stránku PDF na jeden list; nezapínat další režim „2 stránky na list“ v ovladači.

Každý hráčský arch má vlastní záhlaví, název týmu, kolo a stránkování. Organizační arch nemá pole Tým ani Stůl. Vnitřní okraje jsou 24 bodů (přibližně 8,5 mm) od kraje i řezu. Text je sázen přímo v cílové velikosti, nikoli zmenšováním celé A4. Psaní má ve standardní šabloně výchozích 30 bodů na řádek, v úsporné 24 bodů. Hustší kolo přizpůsobí výšku řádků a písmo (nejméně 8 bodů) a podle potřeby použije dva sloupce. Tým zvýrazňuje světlý zlatý pruh, kola mají samostatné podbarvené záhlaví. Černobílá varianta zachovává hierarchii bez barev.

Při tisku všech týmů se párují odpovídající archy vždy dvou týmů. Archy případného posledního lichého týmu pokračují po dvou vedle sebe. Celé PDF vždy obsahuje právě jeden univerzální rezervní arch bez jména, a to pro lichý i sudý počet týmů. Má ručně doplnitelné kolo a číslované prázdné linky podle nejvyššího počtu otázek v jednom kole; lze na něj napsat plnou odpověď, písmeno možnosti nebo Pravda/Lež. Není kopií konkrétního kola ani náhradní sadou pro další tým. Pokud po jeho vložení zbývá polovina posledního listu, zůstane prázdná. Prázdný arch, jeden vybraný tým i organizační dokument dávají dvě stejné kopie vedle sebe. Celý blok každého kola se musí vejít na jednu stranu jedné poloviny A4; úsporný režim spojuje pouze celé bloky. Příliš husté kolo se srozumitelně odmítne místo rozdělení nebo nečitelného zmenšení.

Editor obsahuje jednoduchou výchozí šablonu a rozbalitelné vlastní texty/logo. Změna šablony nezahazuje uložené vlastní nastavení. Již připravená akce nepřebírá novější úpravy knihovny.

## Skutečný způsob odpovědi

Server převádí existující soukromý snapshot přes stejné `mapEditorSlide`, `semanticQuestionType` a `correctOptionIndex` jako editor/doménová validace. Mediální druh neurčuje způsob odpovědi. Interní tiskový model nese `answerMode` a přesný `choiceCount`; neznámé nebo neplatné varianty se odmítají.

- Výběr: přesně 2–6 prázdných vektorových kroužků A–F. Současná herní logika podporuje jednu správnou možnost; pokyn tomu odpovídá. Vícenásobný výběr se nezavádí.
- Volná odpověď: prázdná linka, bez domyšlené bodové hodnoty.
- Zachovaný legacy typ Pravda/Lež: dvě neoznačené možnosti dle skutečné doménové sémantiky.
- Hráčská větev rendereru nikdy nečte `answer` ani `choiceLabel`, ani při výpočtu stránkování. Organizační arch používá stejný kanonický zápis odpovědi jako klíč a každá polovina má označení **PRO ORGANIZÁTORA / SPRÁVNÉ ODPOVĚDI / NEDÁVAT HRÁČŮM**. Samostatný klíč zůstává přehledovým dokumentem.

PDF používá zabalené Noto Sans pro českou diakritiku, navy `#0B1220` a drobný akcent `#FFC107` z identity aplikace, vektorový JK a slovní logo. Vlastní uložený akcent zůstává respektován. Černobílý režim používá textové/vektorové logo místo barevného rastrového obrázku; UI na to upozorňuje a endpoint nepotřebuje nevyužitý obrázek načítat. Žádná nová závislost.

## Jednodušší editor a náhled (2026-10-16)

Editor nabízí pouze standardní nebo úsporné rozložení a tři přepínatelné ukázky: hráčský arch, organizační arch a bodovací tabulku. Ukázky jsou statické PNG z reálného rendereru, jasně označené jako vzorová data; nečtou obsah upravovaného kvízu. Generuje je lokální `tools/print/build-editor-samples.mjs` do `output/pdf/print-editor-samples`, následně se rasterizují Popplerem do `apps/web/public/print-samples`. Veřejné soubory obsahují jen umělá ukázková data. Změna rozložení zachovává dříve uložené texty a branding, nové nastavení se do již připravené akce promítne až po jejím novém připravení.

Samostatná stránka `/admin/events/:eventId/print` má kompaktní výběr tří hlavních dokumentů, doplňkový klíč a skutečný PDF náhled vedle ovládání. Běžně jsou dostupné jen týmy a barevnost; rozložení a aktualizace týmů jsou pod „Další možnosti“. Volby přepisující logo a pokyny byly odstraněny z rozhraní; uplatňuje se uložený vzhled připraveného kvízu. Bez změny backendu, oprávnění, uložených dat a formátu PDF.

## Zachované hranice

Používá se stávající `generatePrintArtifact` v `europe-west1`, aktuálně přiřazený neměnný snapshot a serverem vybraný přijatý registrační seznam. Tiskový tým obsahuje pouze ID a název. Kontakty, zadání, soukromé poznámky a média otázek se do hráčských dokumentů nepřidávají.

Oprávnění jsou `event.export`, pro klíč i organizační arch navíc `event.answers.read` a `event.answers.export`, vždy s aktivním členstvím a rozsahem dané akce. Identita se ověřuje před načtením; oprávnění a vazba aktuálního snapshotu se kontrolují znovu před odesláním PDF. Žádné změny Rules, kolekcí, IAM, herní logiky, uložených kvízů nebo snapshotů. Odpojený/přepnutý náhled se zahazuje a jeho Blob URL se uvolňuje; změna identity, oprávnění nebo soukromého typu vyžaduje nové potvrzení.

## Oprava formuláře

Původní `PrintTemplateFields` používal `.editor-field` a `.editor-card`, pro které neexistovaly styly. Ovládací prvky a dlouhé popisky tak zůstávaly v řádkovém toku. Tisk nyní používá existující `.form-field` doplněné lokální mřížkou, `min-width: 0`, omezením šířky a rozložením do jednoho sloupce na úzkém displeji. Žádné absolutní polohování ani překrývání přes z-index.

## Ověření a podklady

- Jednotkové testy: renderer včetně skutečných PDF instrukcí, detekce odpovědí, možnosti 2–6, média, PL, konzistence snapshotu, request allowlist, bezpečnost náhledu při změně identity/oprávnění, zachování editorových voleb.
- `tests/browser/print-redesign.spec.mjs`: skutečný prohlížeč, izolované Auth/Firestore/Functions/Storage emulátory `demo-print-redesign`, 67 otázek a dva týmy. Náhled a stažení se porovnávají hashem; 1440/768/390 px, klávesnice, rozložení popisků, anonymní 401 a odmítnutí klíče moderátorovi 403. Jen chybová větev simuluje HTTP 503; úspěšné PDF používá skutečný endpoint. Síťový filtr povoluje loopback a interní PDF prostředky Chromia, nikoli externí služby.
- `tests/e2e/print-two-up-pdfs.mjs`: 16 syntetických dokumentů v `output/pdf/print-two-up`, čtyři ABCD otázky, smíšený kvíz, A–F, šest kol/67 otázek, obě šablony a barevnosti, organizační arch, klíč, bodovací tabulka, lichý počet týmů a prázdný arch.
- `tests/e2e/print-two-up-review.py`: skutečné PDF vykreslí Popplerem, ověří A4 na šířku, obě poloviny, řez, meze textu, všech 67 otázek na každé straně páru a nepřítomnost soukromých odpovědí/kontaktů. PNG se kontrolují vizuálně. Přesný počet fyzických listů závisí na šabloně a délkách názvů a odpovědí.
- Fyzický tisk na tiskárně nebyl proveden.

## Rozsah vydání

Hosting site `justkviz-v2`, technický V2 projekt `filmovy-kviz-v2-staging`, web `https://justkviz-v2.web.app`. Aktualizovat pouze Function `generatePrintArtifact` a Hosting. Nejprve backend s novým volitelným `colorMode`, potom web. Stávající klient zůstává kompatibilní s novým backendem. Při rollbacku nejprve vrátit Hosting a potom případně renderer; žádná data se nemigrují. Přesný commit a sestavení budou v lokálním návrhu vydání. Tento dokument není doklad o provedeném nasazení.
