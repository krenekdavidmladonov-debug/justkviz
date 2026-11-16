# Ochrana osobních údajů — čeká na doplnění

Ve vydání Hostingu `4d183f8bac4bc5a6` vede `/privacy` na chybovou stránku. Anonymní Chrome ověřil otisk nasazeného vstupního HTML a skutečný nadpis stránky. Lokální kandidát má trasu `/privacy` a odkaz v registračním formuláři i v patičce. Před dalším nasazením ověřit, že vydaný balík skutečně obsahuje trasu a odkaz, a že text obsahuje schválené údaje správce.

Potvrzené rozhodnutí: provozovatel a zamýšlený správce je fyzická osoba. Její právní jméno a veřejný kontakt nebyly dodány: WAITING_FOR_OWNER. Historické autorské jméno ani soukromou adresu nepřebíráme jako právní údaje. /privacy a OAuth informace zůstávají výslovně označené návrhem; nic není definitivní prohlášení.

| Údaje a skutečný účel | Návrh právního důvodu / uchování |
|---|---|
| Název týmu, počet členů, e-mail, stav/časy: účast, kapacita a správa přihlášky | Plnění smlouvy/kroky před uzavřením, pokud odpovídá skutečnému pořádání; potvrzení vlastníkem chybí |
| Kontaktní e-mail a registrační komunikace při zapnutém odesílání | Návrh 90 dnů po skončení akce; NENÍ schválená právní lhůta, nezačíná automatické mazání |
| Výsledky a názvy týmů | Historie oddělená od nepotřebných e-mailů; veřejná prezentace jen schváleným rozsahem, do názvu mohou lidé vložit osobní údaje |
| Event-scoped hash kontaktu a limit, bezpečnostní audit | Přiměřený oprávněný zájem na ochraně; posouzení a konkrétní retence WAITING_FOR_OWNER; hash není anonymizace |
| Účty obsluhy: UID/e-mail/zobrazované jméno, členství/oprávnění | Správa přístupu a provoz, konkrétní důvod a retence WAITING_FOR_OWNER; heslo zpracovává Firebase Auth |
| Provozní IP/čas/chybové záznamy, emailové podklady, zálohy | Přesný rozsah a doba podle skutečně používaných služeb nejsou inventarizované |
| Volitelné staff Drive/Gmail propojení | OAuth identita/metadata a šifrovaná oprávnění; účastník vlastní Google účet nepřipojuje |

Firebase a Google Cloud zajišťují přihlášení, server a úložiště. Google uvádí, že Firebase Authentication zpracovává údaje v USA. Region Functions neprokazuje umístění všech ostatních služeb. U Drive a Gmailu potvrdit skutečné účty a typ smlouvy. U Firebase a Google Cloud potvrdit smluvní subjekt, použitelné zpracovatelské podmínky, příjemce a mechanismus předání mimo EHP včetně možnosti získat informace o zárukách. [Umístění a role u Firebase](https://firebase.google.com/support/privacy) · [Zpracovatelské podmínky Firebase](https://firebase.google.com/terms/data-processing-terms/)

Při kontrole registračního klienta a vstupní šablony jsme nenašli integraci webové analytiky ani marketingových značek. Firebase přihlášení, stav rozepsaných úloh a volitelná offline instalace používají úložiště prohlížeče. Samostatně ověřit, jak se chovají vložené přehrávače na skutečně používaných stránkách. Kód při zobrazení YouTube videa načítá rozhraní YouTube. Z kontroly registrace nelze odvodit, jaké ukládání provádí přehrávač. O souhlasu rozhodnout podle skutečného účelu a nezbytnosti ukládání v daném toku. [ÚOOÚ k technickému ukládání a souhlasu](https://uoou.gov.cz/verejnost/qa-otazky-a-odpovedi/cookies) · [Zákon č. 127/2005 Sb., § 89 odst. 3](https://e-sbirka.gov.cz/sb/2005/127)

Žádost o přístup, opravu, výmaz, omezení, přenositelnost či námitku podle podmínek použitelného právního důvodu bude přijímat doplněný kontakt. Ověřit žadatele bez zasílání hesla nebo správního odkazu; stížnost lze podat ÚOOÚ. Zrušení registrace uvolní místo, ale není výmaz. Konkrétní provedení výmazu musí zahrnout registrace, outbox, otisky, audit a zálohy a zachovat cizí výsledky. Tato verze automatické mazání nezajišťuje.

Vlastník má před zveřejněním potvrdit čtyři věci.

1. Jméno správce a veřejný kontakt pro žádosti. Určit, kdo žádost vyřizuje a jak bezpečně ověřuje žadatele.
2. Kdo akce pořádá, zda a kdy vzniká smlouva a zda jsou některé akce placené. Podle toho potvrdit právní základy a případnou potřebu samostatných podmínek účasti. Pro bezpečnostní otisky doložit oprávněný zájem a dobu uchování.
3. Které služby a účty reálně zpracovávají údaje, kdo je příjemcem a jaké podmínky platí pro předávání. Oddělit registrační e-mail od volitelných provozních služeb.
4. Retenci kontaktů, výsledků a provozních záznamů. Výchozí návrh pro kontakty je 90 dnů po akci. U historie ponechat jen údaje nutné k doložení výsledku, přezkoumat ji jednou ročně a odstraňovat nepotřebné identifikátory. Určit samostatně retenci bezpečnostních záznamů a záloh a způsob, jak při obnově nevracet už vymazané údaje.

Po potvrzení doplnit stávající stránku a ověřit odkaz přímo před odesláním přihlášky. Návrh je technický podklad a neaktivuje automatický výmaz. [GDPR, čl. 5, 6, 12–14, 28 a 44–49](https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX%3A32016R0679)
