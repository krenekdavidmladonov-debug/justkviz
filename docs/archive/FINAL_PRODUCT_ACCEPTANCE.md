# JUSTKVÍZ V2 — FINAL ACCEPTANCE

Podklad kandidáta z 15. 10. 2026 před dokončením [finální integrace a CI v PR #41](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/pull/41). Aktuální výsledek integrace a přesný merge commit uvádí PR a závěrečné předání. Toto je uzavření existující V2, nikoli nové funkční zadání. Produkční V1 není cílem tohoto vydání.

| Oblast | Hotovo | Blokující problém | Důkaz |
|---|---|---|---|
| Editor, média, uložení a připravená verze akce | BLOCKED | Integrační regrese odhalila návrat původního názvu staršího kola při přejmenování/kopii; oprava vyžaduje nové ověřené nasazení dvou Functions | [Nasazený SHOW MODE](SHOW_MODE_STAGING_B456606.md); oprava sjednocuje titulek úvodu, názvy slidů a odvozeného kola, původní regresní kontrola zůstává zachovaná |
| Moderování, bodování, remízy, výsledky, SHOW MODE, historie a PDF | PASS | Žádný doložený P0/P1 | Stejný nasazený zdroj `b456606`; online SDK a browser evidence v předání, bez nového zásahu do těchto modulů |
| Veřejná registrace a samoobslužný odkaz | PASS | Samotná registrace není závislá na e-mailu | Registrační kontrakty a browser testy; server vytváří a ověřuje správu registrace |
| Běžné registrační e-maily | BLOCKED | Staging omezuje příjemce na jednu adresu a fronta je PAUSED | Čerstvý readback 15. 10.; oprava opt-in a cílená regrese připravené pro schválenou aktivaci |
| Účty a oprávnění | BLOCKED | Existující členství fungují, ale vytváření a přijímání pozvánek blokuje `collaborationEnabled: false` | Čerstvý readback revize 21; kolekce pozvánek prázdná; přístupové kontrakty v CI |
| Integrace a CI | BLOCKED | Uzavřít finální PR a jeho kontroly | Větev `codex/final-product-closure`; nový CI job spouští existující SHOW a whole-evening testy |
| Fyzický projektor, zvuk a tisk | NOT TESTED | Vyžaduje sestavu a potvrzení vlastníka | [Krátký provozní pilot](FINAL_PRODUCT_PILOT.md) |

## Co zbývá schválit v jednom kroku

Přesný clean zdroj a hash neměnného balíčku doplní připravený návrh po dokončení kontrol. Cílem je výhradně `filmovy-kviz-v2-staging`, region `europe-west1`:

1. Aktualizovat pouze `deliverEmailTask`, `dispatchRegistrationEmail`, `createEventRegistration`, `updateEventRegistration`, `cancelEventRegistration`. Zachovat identity, privátní worker, existující číselné verze secrets a ostatní konfiguraci. Použít `REGISTRATION_EMAIL_RECIPIENT_POLICY=future-public-registration` a jediný nový okamžik aktivace pro všech pět funkcí. Fronta během změny zůstane pozastavená.
2. Po ověření všech pěti funkcí zapnout frontu pro potvrzení, změnu a zrušení veřejných registrací vzniklých až po aktivaci. Staré zprávy, staré registrace, ručně založené týmy a organizační kampaně jsou z tohoto rozsahu vyloučené. Nový privátní marker a původní čas registrace ověřuje enqueue, dispatcher i worker; neprobíhá backfill.
3. Ověřit jednu novou testovací registraci, její změnu a zrušení třemi skutečnými zprávami na již ověřenou adresu vlastníka. Neprovádět hromadné rozesílání ani čištění fronty.
4. Atomicky zapnout pozvánky `accessControl/state.collaborationEnabled`, zvýšit revizi a vytvořit auditní záznam. Před zápisem znovu ověřit očekávaný stav a nepřítomnost starých platných pozvánek. Tento krok nemění žádné existující členství ani roli a sám neposílá e-mail.
5. Aktualizovat také `updateQuizRound` a `duplicateQuizRound` kvůli doložené chybě názvu staršího kola. Tyto dvě Functions mění jen zdroj; konfigurace a oprávnění zůstávají zachované. Ověřit přejmenování a kopii na izolovaném testovacím kvízu. Celkový návrh má sedm Functions ve dvou oddělených balíčcích.

Hosting zůstává na ověřené verzi `b4566066e72c423136a29733384280b7c0d42c0d`, verze `a8e737029fb4a85f`. Nový dokumentační nebo CI commit není důvod pro nový Hosting deploy. Žádná změna Rules, indexů, IAM, secrets, produkční V1 ani produkční migrace není součástí návrhu.

## Postup při problému

Při nejasném výsledku zápisu nejprve načíst potvrzený stav; neopakovat create naslepo. Při chybě e-mailového zapnutí ponechat či znovu pozastavit frontu a ověřit stav zprávy před opakováním. Již doručenou zprávu nelze vzít zpět. Při chybě pozvánek použít opačný auditovaný CAS; nerevidovat uživatele hromadně. Případný návrat pěti Functions používá zachované předchozí source pointers a konfiguraci jako jeden kompatibilní celek. Oprávnění k případnému rollbacku musí být součástí konkrétního schválení.

Finální přijetí vyžaduje zelené integrační kontroly, schválené a ověřené provozní zapnutí a potvrzení fyzického pilotu vlastníkem. Náhrada produkční V1 je samostatné rozhodnutí.

Cílené lokální kontroly: `pnpm check` PASS, 50 Security Rules testů PASS, 39 e-mailových unit testů PASS, 13 emulátorových skupin PASS a 23 testů auditovaného zapnutí/pozastavení spolupráce PASS. Nový celý večer má aplikační a PDF důkazy PASS s ověřenou vazbou zdroje a runtime; jeho lokální proces byl přerušen při úklidu emulátoru. Není vydáván za celý proces PASS. Samostatný CI job ověří čistý integrační běh.
