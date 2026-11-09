# Vydání offline kvízu V1.0

Offline večer používá stávající JustKvíz V2. Přehled pro moderátora je v [návodu](OFFLINE_MODE.md). Tento postup vyžaduje samostatné schválení každého zásahu do živého prostředí.

## Přesný cíl a rozsah

Projekt `filmovy-kviz-v2-staging`, region Functions `europe-west1`, Hosting site `justkviz-v2` a původ `https://justkviz-v2.web.app`. Historický název projektu je technické ID stávajícího V2. Při kontrole vydání použijte [strojově čitelný inventář](../tools/offline/deployment-manifest.json) a [samostatnou konfiguraci Hostingu](../firebase.offline-hosting.json).

| Součást | Rozsah |
| --- | --- |
| Nové callables | `readOfflineTrust`, `prepareOfflineEvent`, `authorizeOfflineEvent`, `previewOfflineSync`, `commitOfflineSync` |
| Existující gateway | `readQuizMedia` ověřuje stav exportu, členství, uzamčený snapshot a přesnou generaci vlastního Storage objektu před čtením a před odesláním. Běžné čtení online médií používá dosavadní cestu. |
| Podmíněné předpoklady | Porovnejte nasazené `beginQuizMediaUpload`, `finalizeQuizMediaUpload`, jejich úzká Storage Rules pro MP4 a registr mazání exportů v `deleteEvent` s kandidátem. Aktualizujte pouze skutečně chybějící kompatibilní části. |
| Firestore | Stávající pravidla zakazují přímé čtení a zápis offline exportů. Změna Rules, indexů ani migrace se pro tento rozsah neplánuje. |
| Hosting | Standardní `index.html` plus `offline.html`, `offline.webmanifest`, `offline-sw.js` a jejich verzované statické soubory. Manifest a Service Worker mají rozsah `/offline.html`. Přednačtení ověřuje SHA-256 a zakazuje přesměrování. |
| Klíč | Aktivace vyžaduje dostupný a schválený serverový secret binding `JUSTKVIZ_OFFLINE_SIGNING_KEY`. Používají ho jen `readOfflineTrust` a `prepareOfflineEvent`. Hodnota je samostatný PKCS#8 P-256 klíč. Před vydáním potvrďte dostupnost pod stávající identitou. |

Běžný build v režimu `staging` offline soubory neobsahuje. Build s výslovným `VITE_JUSTKVIZ_OFFLINE=true` je obsahuje a povoluje přípravu z detailu akce. Hodnota `recovery` ponechá offline spuštění a synchronizaci a skryje přípravu. Webová volba sama nezapíná server. Po aktivaci server vyžaduje přesný projekt, schválený původ, platný Auth token, aktuální členství, osm konkrétních oprávnění a povolenou akci. Úlohy pro starší zálohy obrázků zůstávají samostatné.

## Před vydáním

1. Uložte aktuální veřejný zdroj a otisky nasazeného Hostingu, revize Functions, runtime identity, secret bindings, Storage a pravidla. Potvrďte, že správa uživatelů a pozvánek používá stejný nebo kompatibilní hotfix a že nové artefakty zachovají stávající konfiguraci. Starší protokoly a hlášení vlastníka neurčují právě běžící revizi.
2. Potvrďte, že lze použít existující klíč a prostředky bez dalších oprávnění a nových výdajů. Ověřte datové toky a skutečné limity účtu před schválením aktivačního kroku.
3. Ze stejného čistého commitu spusťte `node tools/offline/prepare-release.mjs enabled` se schválenou konfigurací Firebase V2. Volby `disabled` a `recovery` sestaví samostatné varianty. Příkaz připraví Hosting, výběr Functions, uzamčené závislosti a kontrolní součty pod `.local-data/offline-release/`. Volba `--synthetic` používá testovací konfiguraci a výsledný soubor Firebase označí jako příklad. Příkaz pracuje pouze s místními soubory. Tajemství ani seznam povolených akcí do webové konfigurace nepatří.
4. Pro ověření tvaru a aktualizace Hostingu použijte `pnpm test:offline:hosting`. Test staví všechny tři varianty se syntetickou konfigurací a otevírá je na izolovaném lokálním TLS serveru. Skutečný produkční webový artefakt vyžaduje schválenou konfiguraci existující aplikace. Pro přesný nasazovaný artefakt zopakujte kontrolu inventáře a otisků.

## Po schválení

1. Nasaďte jen nezbytné Functions ve vypnutém režimu. Ověřte, že odmítnou pokus o přípravu a že online přihlášení, přístupy a stávající média fungují. Pokud chybí kompatibilní MP4 předpoklady, řešte jejich úzké nasazení a ověření před zpřístupněním přípravy.
2. Po schválení aktivace nastavte `JUSTKVIZ_OFFLINE_ENABLED=true` a `JUSTKVIZ_OFFLINE_EVENT_IDS` na 1 až 10 přesných ID existujících povolených akcí oddělených čárkou. Shodné hodnoty musí mít aktivní revize všech pěti offline Functions a `readQuizMedia`. Binding připněte pouze ke dvěma uvedeným callable funkcím. Zachovejte současnou konfiguraci každé aktualizované funkce, včetně případných vazeb mediální brány. Zkontrolujte přesný seznam nasazovaných funkcí podle inventáře.
3. Nasaďte pouze Hosting na site `justkviz-v2` z ověřeného artefaktu. Zkontrolujte otisky, typ a čerstvost odpovědí offline souborů, CORS pro schválený původ, platný podpis, platný uzamčený snapshot a odpověď bez cache. Ověřte odmítnutí jiného účtu a jiné akce. Pro funkční zkoušku použijte výhradně předem schválenou izolovanou syntetickou akci.
4. Zopakujte průchod z návodu na cílovém notebooku a projektoru, včetně odpojení, restartu a potvrzení synchronizace. Praktická generálka je samostatná akceptace.

## Stažení funkce a náklady

Při problému nastavte `JUSTKVIZ_OFFLINE_RECOVERY_ONLY=true` na aktivních revizích všech pěti offline Functions a gateway. Ponechte `JUSTKVIZ_OFFLINE_ENABLED=true` a původní seznam povolených akcí pro oba synchronizační endpointy. Ověřte, že staré revize nepřijímají provoz a rozpracované přípravy doběhly. Použijte obnovovací Hosting. Obsluha může otevřít uložený průběh a synchronizovat ho v profilu, který má dříve ověřený veřejný klíč. V obnovovacím režimu je příprava nového profilu vypnutá. Při kritické závadě synchronizace pozastavte zápisy, ponechte uložené soubory a připravte kompatibilní opravu.

Předchozí Hosting lze obnovit na jeho zaznamenanou verzi. Nainstalované aplikace mohou běžet do konce místního oprávnění. Chrome aktivuje aktualizovaný Service Worker po zavření oken používajících starou verzi. Dříve připnuté veřejné klíče zůstávají v profilu. Před akcí proto ověřte i nezávislý cílový profil. Po výměně klíče otevřete starý průběh v dříve připraveném profilu. Nový balíček lze použít pro dosud neodehranou akci a zakládá vlastní historii.

Úplný balíček vyvolá až dva průchody 512 MiB médií přes Storage a odeslání 512 MiB přes gateway. K tomu se přidávají operace Firestore, běh Functions, přenosy Hostingu a případná cena secret bindingu nebo úložiště artefaktů. Limity velikosti a počtu souběžných instancí nejsou finanční strop. Dokud není pro konkrétní prostředky doloženo nulové navýšení, vydání a aktivace čekají na schválení.
