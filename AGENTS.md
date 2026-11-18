# Pravidla pro práci na JustKvízu

## Produkce a testování

- Firebase projekt `filmovy-kviz-v2-staging` a Hosting site `justkviz-v2` obsluhují **PRODUKCI** se skutečnými daty na [justkviz.cz](https://justkviz.cz).
- V produkci nic netestuj, nespouštěj seed, nic nemaž a neposílej e-maily. Původní aplikace V1 a její Firebase projekt jsou mimo rozsah.
- Testuj pouze lokálně s Firebase Emulator Suite, explicitním projektem `demo-*` a adresami emulátorů na loopbacku. Seed musí skončit před inicializací SDK, pokud tyto podmínky neplatí.
- Nasazuj pouze z commitu na `main` se zeleným CI a až po výslovném souhlasu Davida s konkrétním nasazením v aktuální konverzaci. Přístup k produkčnímu Firebase, zápisy do cloudu a změny IAM vyžadují výslovný souhlas Davida.

### Povinné ověření před testem

- Před prvním testovacím zápisem nebo ovládáním aplikace ověř skutečný projekt `demo-*` a loopback adresy všech potřebných emulátorů. Název staging, doména, testovací název týmu ani přihlášení správce nejsou důkazem testovacího prostředí. Při nejasnosti test nespouštěj.
- Vytvoření, změna i zrušení testovací registrace v produkci jsou produkční zápisy, také přes veřejný formulář nebo odkaz pro správu registrace. Mohou spustit skutečné e-maily. Platí pro ruční ovládání, browser automatizaci, Playwright, přímé SDK i HTTP volání.
- Souhlas pouze se čtením produkce opravňuje k výslovně požadovanému čtení Firestore a Cloud Logging. Neopravňuje spouštět produkční Functions, ani pokud jejich název začíná `read`, `preview` nebo mají parametr `preflight`. Diagnózu reprodukuj na samostatných syntetických datech v demo emulátorech.
- Nález testovacích dat v produkci není souhlas s jejich úklidem. Připrav přesný plán a vyžádej si schválení Davida pro konkrétní zápis; do té doby nic nemaž, neruš, neupravuj ani neposílej e-mail.

## Větve a předání

- Jeden úkol = jedna krátká větev = jeden PR do `main`. Pracuj v hlavním checkoutu a chraň rozpracované změny.
- Nezakládej další worktrees ani autonomní běhy, ledgery, receipt soubory nebo nové reporty. Stav úkolu a výsledek kontrol zapisuj pouze do popisu PR.
- Nemaž nic, co není na GitHubu. Veřejný push a otevření PR musí být součástí zadání od Davida. PR slučuje David.
- Na konci úkolu česky uveď, co se změnilo, číslo PR a jak to David vyzkouší.

## Bezpečnost aplikace

- Do Gitu neukládej tajné údaje, klíče, přihlašovací údaje, soubory `.env`, osobní a produkční data ani soukromé exporty.
- Administrační operace vyžadují aktuální aktivní členství spravované serverem, konkrétní oprávnění a rozsah odpovídající dotčenému zdroji. Ověřuj je na serveru i v Security Rules. Přihlášení, název role ani historické Auth claims samy nepřidělují oprávnění.
- Veřejnému klientu ani projektoru neposílej správné odpovědi před výslovným odhalením. Soukromé dokumenty kvízů, poznámky a kontakty týmů patří jen oprávněným uživatelům.
- Vstup z prohlížeče považuj za nedůvěryhodný. Citlivé zápisy validuj v Cloud Functions a v Security Rules přiděluj nejmenší nutná oprávnění.
- Před změnou datových nebo bezpečnostních hranic čti [architekturu](docs/ARCHITECTURE.md), [datový model](docs/DATA_MODEL.md) a [bezpečnost](docs/SECURITY.md). Spusť `pnpm check` a příslušné testy. Změny přístupu nebo Rules ověř také testy Security Rules v emulátorech.
