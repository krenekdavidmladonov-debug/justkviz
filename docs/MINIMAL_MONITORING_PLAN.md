# Provozní dohled při navýšení 0 Kč

Stav: manuální postup připravený; automatické alerty ani nový cloudový prostředek nejsou aktivované. Neznámá spotřeba není nula. Nezakládat GCP uptime checks, syntetické registrace, placené kanály ani pravidelné požadavky na živou aplikaci bez důkazu nulového navýšení pro konkrétní rozsah.

## Kontrola před akcí

| Krok | Očekávaný výsledek a reakce |
|---|---|
| Veřejná stránka a správná akce | V běžném oprávněném použití se načte správná akce/termín/kapacita; při chybě neotevírat ostrou registraci naslepo |
| Registrace v místní syntetické generálce | Vytvořit, zopakovat tentýž požadavek, upravit a zrušit; jeden tým, správné počty, soukromý správní odkaz. Nikdy testovací zápis do skutečné akce |
| Moderátor/projektor | Správný snapshot, odhalení jen na výslovný povel, video/audio/obrázky, stop a návrat po chybě |
| Existující diagnostika | Zkontrolovat již dostupné místní záznamy a poslední známý výsledek. Přístup ke cloudovým logům/readům není v tomto běhu prováděn; cenu konkrétního přístupu ověřit předem |
| Záloha | Poslední úspěšná a nezávislá kopie skutečných dat musí být doložená. Lokální syntetický PASS není náhradou |
| Papírový postup | Připravené odpovědní archy a způsob ručního zápisu bodů při výpadku |

Tyto pokyny nenastavují cenu běžného provozu aplikace na nulu; jde o přípravu bez přidání placeného prostředku. Nové cloudové operace s neprokázanou nulovou cenou agent neprovádí.

## Jak vyhodnotit problém

Zapsat datum/čas, akci, viditelný problém a poslední potvrzený krok bez kontaktů, odpovědí a správních tokenů. Zopakovat bezpečnou místní kontrolu, otevřít existující diagnostiku jen v povoleném rozsahu. Kontaktovat určenou obsluhu; primární a záložní kontakt zatím WAITING_FOR_OWNER. Nevypínat skutečnou databázi kvůli testu, neopakovat naslepo e-maily a nevracet data ze zálohy automaticky.

Při případném budoucím výslovně bezplatném automatickém dohledu jsou přiměřené prahy: potvrzený výpadek10min, nejméně3neočekávanéchyby/10min, chybějící denní záloha36h. Jedna zpráva při incidentu a jedna při obnově; žádný proud drobných odmítnutí. Tyto prahy jsou návrh, nikoli běžící služba.

## Výslovná omezení

HTML/health odpověď nedokazuje funkčnost registrace ani čtení databáze. Současný marker justkviz.registration.throttled obsahuje pouze bezpečný kód odmítnutí, není obecným registračním alertem. Automatický kontrolor stáří zálohy není implementovaný. Cloudový testovací event nemá doložený samostatný serverový zákaz účastnické i pořadatelské pošty; example.test sám zákaz odeslání nevytváří. Syntetické cloudové registrace se neaktivují.

Bez prokázané bezplatné automatické varianty zůstává dostupnost automatického upozornění **OMEZENÍ/BLOCKED**. Žádný push k placenému monitoringu, změně fakturace nebo novému IAM. Náhradou je předvečerní a průběžná ruční kontrola obsluhou; během doby bez obsluhy se problém nemusí zjistit včas.
