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

| Signál | Odkud ho získat a kdy zasáhnout |
|---|---|
| Dostupnost webu | Ručně otevřít `justkviz.cz` a načíst `/justkviz-connection-check.txt`. Při chybě ověřit z druhého připojení. Tato kontrola sahá jen po statickém souboru Hostingu. |
| Funkce a registrace | Pokud je dostupný schválený přístup k existujícím metrikám V2, zkontrolovat při výpadku počty požadavků a odpovědí `5xx` po jednotlivých službách. Odmítnutí z důvodu kapacity, oprávnění a limitu hodnotit odděleně. Reprodukce zápisu patří do demo emulátoru. |
| Pošta a média | U skutečného hlášení zkontrolovat stav existujícího odeslání a kód chyby, případně údaje o síti, renderu a médiu z `?latency=1`. Pro ověření pošty použít lokálního falešného poskytovatele. Do záznamu nedávat adresy příjemců ani URL médií. |
| Zálohy | Porovnat poslední doložený úspěšný export nebo nezávislou kopii se schváleným intervalem. Chybějící záznam evidovat jako neověřenou zálohu. Postup obnovy je v `BACKUP_RECOVERY_PLAN.md`. |
| Náklady | Vlastník z existujícího přehledu porovná týden se srovnatelným týdnem včetně počtu akcí. Při odchylce zjistí dotčenou službu a změnu spotřeby. Rozpočtové upozornění samo výdaje nezastaví. [Rozpočty Google Cloud](https://docs.cloud.google.com/billing/docs/how-to/budgets) |

## Jak vyhodnotit problém

Zapsat datum/čas, akci, viditelný problém a poslední potvrzený krok bez kontaktů, odpovědí a správních tokenů. Zopakovat bezpečnou místní kontrolu, otevřít existující diagnostiku jen v povoleném rozsahu. Kontaktovat určenou obsluhu; primární a záložní kontakt zatím WAITING_FOR_OWNER. Nevypínat skutečnou databázi kvůli testu, neopakovat naslepo e-maily a nevracet data ze zálohy automaticky.

Při případném budoucím výslovně bezplatném automatickém dohledu jsou přiměřené prahy: potvrzený výpadek10min, nejméně3neočekávanéchyby/10min, chybějící denní záloha36h. Jedna zpráva při incidentu a jedna při obnově; žádný proud drobných odmítnutí. Tyto prahy jsou návrh, nikoli běžící služba.

Ke schválení nejprve stačí jedna kontrola statické cesty `/justkviz-connection-check.txt` přes HTTPS, bez přihlášení a bez požadavků na Functions. V návrhu kontrolovat očekávaný text jednou za pět minut, upozornit až po potvrzení neúspěchu nejméně dvěma místy po dobu deseti minut. Před vytvořením potvrdit cenu pro konkrétní počet požadavků a existujícího příjemce. Kontrolu vyzkoušet porovnáním očekávaného textu a záměrně jiné odpovědi v místním prostředí. Pokud přináší šum, vypnout pouze tuto kontrolu a její pravidlo. [Nastavení kontroly dostupnosti](https://docs.cloud.google.com/monitoring/uptime-checks) · [Účtování Google Cloud Observability](https://cloud.google.com/stackdriver/pricing)

## Výslovná omezení

HTML/health odpověď nedokazuje funkčnost registrace ani čtení databáze. Současný marker justkviz.registration.throttled obsahuje pouze bezpečný kód odmítnutí, není obecným registračním alertem. Automatický kontrolor stáří zálohy není implementovaný. Cloudový testovací event nemá doložený samostatný serverový zákaz účastnické i pořadatelské pošty; example.test sám zákaz odeslání nevytváří. Syntetické cloudové registrace se neaktivují.

Bez prokázané bezplatné automatické varianty zůstává dostupnost automatického upozornění **OMEZENÍ/BLOCKED**. Žádný push k placenému monitoringu, změně fakturace nebo novému IAM. Náhradou je předvečerní a průběžná ruční kontrola obsluhou; během doby bez obsluhy se problém nemusí zjistit včas.
