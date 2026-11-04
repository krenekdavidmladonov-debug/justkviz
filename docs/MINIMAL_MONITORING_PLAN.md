# Minimální provozní dohled JustKvízu — návrh

Stav: PROPOSED / NOT ACTIVATED. Ověřeno proti zdrojovým kontraktům a veřejné dokumentaci 4. 11. 2026. Žádná živá konfigurace, IAM, notification channel ani fakturovaná služba nebyla změněna. Příjemce a záložní příjemce upozornění doplní vlastník.

## Přiměřený základ

Použít Cloud Monitoring, Cloud Logging a Error Reporting, které Google Cloud již nabízí. První sada má šest typů problémů, jednu zprávu při otevření incidentu a jednu při obnově. Stejná chyba se seskupuje podle služby a bezpečného kódu. Bez pravidelných zpráv, pokud se nic neděje. Při otevřeném kritickém incidentu nejvýše připomenutí po 60 minutách; běžná upozornění shrnout jednou denně. Během oznámené údržby krátké vymezené mute okno, nikdy trvalé potlačení chyby.

| Co | Zdroj signálu | Navržený práh a reakce |
| --- | --- | --- |
| Veřejný web | HTTPS GET `/events` na finální schválené doméně, 3 lokality po 5 min; očekávat200 + stabilní marker HTML | 2 ze3 lokalit selžou po10 min → kritický incident; při návratu oznámit obnovu |
| Backend | Existující `health` Function, HTTP200 a JSON status ok; request/error metriky konkrétních Functions/Cloud Run revisions | health 2ze3/10min; neočekávané5xx ≥3 za5min nebo podíl≥5% při≥20 požadavcích/10min → kritické |
| Registrace | backend chyby create/update/cancel, stav čtení veřejné akce; předvečerní syntetický create/retry/cancel | neočekávané internal/unavailable/deadline ≥3 za10min nebo2 souvislé syntetické chyby → kritické; invalid input/closed/full nejsou výpadek |
| Databáze | `firestore.googleapis.com/api/request_count` dle response_code; latency dashboard | unavailable/deadline ≥3 za5min; ≥5% při≥20requests/10min; p95>2s po15min a≥20requests → varování |
| Záloha | metadata konkrétního backupu ve stavu READY a jeho čas; dokončený media manifest | žádný READY denní backup za36h nebo poslední pokusFAILED → kritické; chybějící media checkpoint před akcí → nelze potvrdit generálku |
| Kritická chyba v provozu | Error Reporting, neočekávaný runtime error/paměťový limit, bezpečný provozní kód | nová stejná neočekávaná chyba≥3/10min; opakovaný crash≥2/10min → incident, bez surového payloadu |

Práh36h počítá s neurčenou hodinou denní managed zálohy. Čas posledního READY je třeba kontrolovat přímo; pouhé chybějící logy chyb nedokládají zdravou zálohu. Dokud není schválený automatický read-only kontrolor backup metadata/heartbeat, provozovatel kontroluje READY čas denně a před akcí; automatické odhalení chybějící zálohy je do té doby neaktivované. Backup kontrolor musí používat existující oprávnění, žádné automatické nové grants.

Public uptime checks podporují kontrolu HTTP stavu i markeru obsahu a vícelokalitní rozhodnutí. [Uptime checks](https://docs.cloud.google.com/monitoring/uptime-checks). U Firestore jsou request/latency metriky dostupné s časovým zpožděním, proto se nehodí pro slib okamžitého oznámení. [Firestore metric definitions](https://docs.cloud.google.com/monitoring/api/metrics_gcp_d_h?hl=en).

## Přesná mez registrace a browseru

Existující `functions/src/index.ts` endpoint `health` výslovně nečte databázi. Dostupná HTML stránka neprokazuje vykreslený React, čtení Firestore ani úspěšnou registrační transakci. Nový limiter má pouze pevný marker `justkviz.registration.throttled`, nikoli obecný signál úspěchu registrace nebo neočekávané chyby. Detailní registrační alert není implementovaný. HTTP a runtime signály pokryjí dostupnost a neočekávané backend chyby, nikoli každý funkční regresní případ.

Nejméně před každou akcí po změně aplikace projít lokální synthetic registration browser/API test a běžnou generálku. Pro nepřetržitou kontrolu skutečné cloudové registrace navrhujeme po konkrétním schválení oddělenou syntetickou testovací akci bez skutečných účastníků a s vypnutou e-mailovou cestou. Úloha ověří create→stejnýretry→read→cancel a přesné počty. Je to zápis do cloudových dat a možný placený monitor: automaticky se neaktivuje. Žádné testovací registrace do skutečné akce a žádný reálný e-mail.

Alternativou pro nižší složitost je rozšířit bezpečný error marker o neočekávané chyby registračních callable operací a provádět předvečerní ruční smoke. Existující marker throttled není kritický výpadek; souhrn ≥20 odmítnutí za 10 minut může upozornit na ručně zkontrolovatelný nárůst. Marker musí mít výhradně allowlist operation/result/code; nikdy request payload, e-mail, jméno týmu, URL s tokenem, IP ani správné odpovědi. Odlišit očekávané business odmítnutí od neočekávaného backend selhání. Přidání markeru má vlastní unit/emulator testy a release review; tento dokument ho neaktivuje.

## Náklady a režim upozornění

Dva HTTPS cíle ×3 lokality ×12 kontrol/h ×24h ×30dnů =51 840 regionálních provedení/měsíc. To je pod nynější volnou kvótou1milion uptime executions/projekt/měsíc. Nad kvótu je sazba0,30 USD/1000. Předpoklad vyžaduje, že ostatní kontroly společnou kvótu nevyčerpají. Backend volání a data mají vlastní běžné náklady.

Cloud Logging má nyní prvních50GiB/projekt/měsíc zdarma; nad to0,50USD/GiB a další retence nad30dnů zvlášť. Error Reporting sám nemá poplatek, jeho logy se započítávají. Použijeme přednostně Google poskytované metriky; nevytvářet vysokokardinalitní labels ani per-team time series. Skutečný objem logů není inventarizovaný. Pro malé použití je očekávaný přírůstek této základní sady0USD při zachování volných kvót, nikoli garantovaný účet.

Aktuální oficiální ceník uvádí účtování alerting policies nejdříve od1.9.2027:0,35USD/metric reference/měsíc plus query points; nelze ho nyní účtovat do listopadu2026 jako již platný poplatek. Ceník znovu zkontrolovat před aktivací a po změně podmínek. [Observability pricing](https://cloud.google.com/products/observability/pricing?hl=en).

Cloud syntetický monitor je jiný produkt: přes volných100provedení/billing account/měsíc1,20USD/1000 plus runtime/logs. Každých15min je přibližně2880provedení/měsíc, tedy referenčně3,34USD za provedení nad kvótu + běžící Function a logy. Tato alternativa není součást bezplatného uptime základu a vyžaduje schválení. Pokud stačí předvečerní kontrola, nepořizovat ji.

## Co připravit k aktivaci

1. Vlastník potvrdí konkrétní primární a záložní adresu/kanál, aktuální veřejnou doménu a přijatelný měsíční rozpočet. Nepoužívat soukromý kontaktní údaj z Git historie jako automatický notification target.
2. Read-only ověřit skutečné projektové/DB/service identity, regiony, stávající alerty/kvóty a runtime error metric labels. Nevytvářet duplicity. Ověřit možnost přístupu existujícími oprávněními.
3. Předložit přesný seznam dvou HTTPS kontrol, výše uvedených alert policies a read-only backup-age kontroloru, jeho identity a ceny. Rozhodnutí ownera oddělit od implementace: žádný IAM ani placená konfigurace bez schválení.
4. V lokální syntetice testovat vyhodnocení safe failure signálů. Při schválené cloud aktivaci provést kontrolované testovací selhání pouze testovacího cíle, ověřit skutečné doručení a obnovu. Nesmí se vypínat reálná registrace ani živý backend kvůli testu.
5. Zaznamenat skutečný receipt doručení, kdo reaguje a odkaz na recovery postup. Bez této zkoušky netvrdit, že monitoring upozorní vlastníka.

Při incidentu operátor nejprve otevře stav Hosting/Functions/Firestore a poslední release; zastaví vlastní nové změny, zaznamená čas a výsledek kontroly. Nevrací automaticky databázi, nemaže média a neopakuje naslepo e-maily. Rollback aplikace a obnova dat jsou odlišné zásahy, oba pouze v konkrétně schváleném rozsahu.
