# JustKvíz — pětiminutová kontrola před akcí

Předem připravte oddělený syntetický kvíz a zkušební relaci. Stačí krátký text, malý PNG a několik sekund zvuku. Obrázek a zvuk nahrajte v editoru jako vlastní soubory do Storage, aby se při zkoušce četly přes `readQuizMedia` se stejnou kontrolou oprávnění jako při akci. Používáte-li na akci video, připravte i krátký zkušební klip ze stejného typu zdroje. Pro kontrolu použijte počítač, prohlížeč, projektor a reproduktory připravené pro akci.

| Čas | Kontrola | Co potvrdit |
| --- | --- | --- |
| 0:00–1:00 | Na síti provozovny otevřete z moderování zkušební projektor na druhé obrazovce. Přejděte na textovou otázku. V **Technické diagnostice** stiskněte **Otestovat připojení**. | Na plátně je aktuální snímek a okraje jsou čitelné. Syntetická odpověď zůstává skrytá. Moderování ohlásí výsledek kontroly webu. |
| 1:00–2:00 | Přejděte na otázku s vlastním PNG. Pro první pokus otevřete projektor v čerstvém anonymním okně. | Obrázek se vykreslí. V síťovém panelu projektoru vyhledejte `readQuizMedia` a zkontrolujte stav 200 u PNG. Při opakovaném čtení může gateway povolit 304. |
| 2:00–3:00 | V moderování stiskněte **Play** a **Stop** u krátké zvukové ukázky. Zopakujte s videem, pokud ho akce používá. | Zvuk je slyšet z připravených reproduktorů, video je vidět na plátně a **Stop** ukázku zastaví. Ověřte hlasitost a sledujte, zda ukázka nezačala před **Play**. |
| 3:00–4:30 | Přepněte zkušební sestavu na záložní hotspot. Na telefonu vypněte Wi‑Fi, zapněte mobilní data a ověřte jejich funkčnost. Po připojení znovu zobrazte vlastní PNG a přehrajte krátkou ukázku. | Projektor převezme aktuální snímek, obrázek se zobrazí a zvuk projde stejnými reproduktory. Pokud zkoušíte výpadek, nechte projektor otevřený a během výpadku změňte snímek z moderování na funkčním připojení. Po návratu se má zobrazit nová otázka. |
| 4:30–5:00 | Zapište výsledky a připravte [krizovou kartu](EVENT_NIGHT_FAILURE_CARD.md). | U každé kontroly uveďte **PROŠLO**, **SELHALO** nebo **NEPROVEDENO**. Úspěšně otestovanou síť zvolte pro akci. |

Zaznamenejte verzi sestavení, čas, sestavu, použitou síť a první fázi, která selhala. **Technická diagnostika** moderátora ověřuje dosažitelnost webu. Stav připojení, načtení stránky a přechod textového snímku samy nepotvrzují přenos z mediální gateway. Stav HTTP zaznamenejte zvlášť od viditelného obrázku, zvuku či videa. Uveďte pouze kategorii chyby a případné časy. URL požadavků, hlavičky s přihlašovacími údaji, odpovědi ani síťové exporty do záznamu nepatří.

Při závadě zastavte médium a vyčkejte na potvrzený aktuální snímek. Po ověření připojení zkuste jedno ruční opakování média. Pokud se obsah neobnoví nebo závada trvá, pokračujte podle [krizové karty](EVENT_NIGHT_FAILURE_CARD.md). Rozšířenou fyzickou zkoušku včetně tisku popisuje [samostatný postup](FINAL_PRODUCT_PILOT.md).

## Technické ověření v lokálních emulátorech

Na čistém checkoutu s nainstalovanými závislostmi, JDK 21 a Chromium zkopírujte `apps/web/.env.example` do `apps/web/.env.local`. Ověřte, že výsledné sestavení používá projekt `demo-filmovy-kviz-v2` a emulátory. Před spuštěním zkontrolujte volné porty 5000, 5001, 8080, 9099 a 9199. Příkazy spouštějte z kořene repozitáře v samostatném PowerShellu s čerstvými emulátory bez importu dat. Pro místní instalaci Chrome nastavte `PLAYWRIGHT_EXECUTABLE_PATH` na cestu k jeho spustitelnému souboru.

```powershell
pnpm check
if ($LASTEXITCODE -ne 0) { throw 'pnpm check selhal.' }

$preflightProfile = Join-Path (Get-Location) '.local-data/demo-preflight-profile'
New-Item -ItemType Directory -Path $preflightProfile -Force | Out-Null
$env:XDG_CONFIG_HOME = $env:APPDATA = $env:CLOUDSDK_CONFIG = $preflightProfile
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS,Env:FIREBASE_TOKEN -ErrorAction SilentlyContinue
$env:GCLOUD_PROJECT = $env:GOOGLE_CLOUD_PROJECT = 'demo-filmovy-kviz-v2'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FUNCTIONS_EMULATOR_HOST = '127.0.0.1:5001'
$env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'

node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore,functions,hosting,storage --project demo-filmovy-kviz-v2 'node tools/local-emulator-environment.mjs full node_modules/@playwright/test/cli.js test --config tests/browser/live-event-preflight.config.ts'
```

- Scénář přihlásí syntetickou obsluhu s členstvím v emulátoru a samostatně otevře anonymní projektor. Produkční sestavení servíruje lokální Hosting. PNG a WAV se skutečně nahrají do emulátoru Storage. Prohlížeč ověří stav 200 a `no-store` z gateway, vykreslení PNG a nativní přehrání WAV po **Play** a zastavení po **Stop**.
- Anonymní projektor nesmí žádat skrytý obrázek odpovědi ani zvuk běžné otázky. Přímá zkušební žádost s veřejnou relací musí u obou vrátit stav 404 bez bajtů. Širší regresi oprávnění při zveřejnění a po opuštění snímku pokrývá `pnpm test:e2e:media`.
- Výsledek emulátorů zaznamenejte odděleně od kontroly fyzického výstupu, mobilních dat a případného YouTube či Drive zdroje na místě. Tyto části mohou projít až po zkoušce na cílové sestavě.
