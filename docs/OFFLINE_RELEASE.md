# Vydání offline kvízu V1.0

Offline večer používá stávající JustKvíz V2. Přehled pro moderátora je v [návodu](OFFLINE_MODE.md). Tento postup vyžaduje samostatné schválení každého zásahu do živého prostředí.

## Přesný cíl a rozsah

Projekt `filmovy-kviz-v2-staging`, region Functions `europe-west1`, Hosting site `justkviz-v2` a dva přesné původy `https://justkviz.cz` a `https://justkviz-v2.web.app`. Historický název projektu je technické ID stávajícího V2. Při kontrole vydání použijte [strojově čitelný inventář](../tools/offline/deployment-manifest.json) a [samostatnou konfiguraci Hostingu](../firebase.offline-hosting.json).

| Součást | Rozsah |
| --- | --- |
| Nové callables | `readOfflineTrust`, `prepareOfflineEvent`, `authorizeOfflineEvent`, `previewOfflineSync`, `commitOfflineSync` |
| Existující gateway | `readQuizMedia` ověřuje stav exportu, členství, uzamčený snapshot a přesnou generaci vlastního Storage objektu před čtením a před odesláním. Běžné čtení online médií používá dosavadní cestu. |
| Mazání | Aktualizujte `deleteEvent` před prvním vydáním offline exportu. Stávající registr nezná `offlineExports` a s již vytvořenými exporty by mazání akce odmítl. Kompatibilní registr ponechte i při návratu. |
| Média | Změna nových MP4 uploadů zůstává samostatným rozsahem. Živé `beginQuizMediaUpload`, `finalizeQuizMediaUpload` a Storage Rules se při tomto vydání nemění. Příprava ověřuje jen už uložené podporované vlastní soubory a jejich generaci. |
| Firestore | Stávající pravidla zakazují přímé čtení a zápis offline exportů. Změna Rules, indexů ani migrace se pro tento rozsah neplánuje. |
| Hosting | Z nynějšího živého zdroje přidejte jediný vstup v detailu akce. Oddělený offline build používá `/offline-assets/`, `offline.html`, `offline.webmanifest` a `offline-sw.js`. Manifest a Service Worker mají rozsah `/offline.html`. Přednačtení ověřuje SHA-256 a zakazuje přesměrování. |
| Klíč | Aktivace vyžaduje dostupný a schválený serverový secret binding `JUSTKVIZ_OFFLINE_SIGNING_KEY`. Používají ho jen `readOfflineTrust` a `prepareOfflineEvent`. Hodnota je samostatný PKCS#8 P-256 klíč. Před vydáním potvrďte dostupnost pod stávající identitou. |

Běžný build v režimu `staging` offline soubory neobsahuje. Build s výslovným `VITE_JUSTKVIZ_OFFLINE=true` je obsahuje a povoluje přípravu z detailu akce. Hodnota `recovery` ponechá offline spuštění a synchronizaci a skryje přípravu. Webová volba sama nezapíná server. Po aktivaci server vyžaduje přesný projekt, schválený původ, platný Auth token, aktuální členství, osm konkrétních oprávnění a povolenou akci. Úlohy pro starší zálohy obrázků zůstávají samostatné.

## Před vydáním

1. Uložte aktuální veřejný zdroj a otisky nasazeného Hostingu, revize Functions, runtime identity, secret bindings, Storage a pravidla. Potvrďte, že správa uživatelů a pozvánek používá stejný nebo kompatibilní hotfix a že nové artefakty zachovají stávající konfiguraci. Starší protokoly a hlášení vlastníka neurčují právě běžící revizi.
2. Potvrďte, že lze použít existující klíč a prostředky bez dalších oprávnění a nových výdajů. Ověřte datové toky a skutečné limity účtu před schválením aktivačního kroku.
3. Ze stejného čistého commitu sestavte `disabled`, `enabled` a `recovery` příkazem `node tools/offline/prepare-release.mjs <režim> --live <ověřený-archiv-Hostingu> <metadata-živého-V2>`. Příkaz přijme veřejnou konfiguraci V2 pouze tehdy, když souhlasí její otisk. Pro `enabled` nejdřív reprodukuje celý živý web ze zmrazených zdrojů. Ponechá i dosavadní verzované soubory pro otevřená okna. `disabled` a `recovery` ponechají živý online web bajtově shodný. Výsledné `receipt.json`, `hosting-manifest.json` a `backend-scope.json` určují přesné vstupy pod `.local-data/offline-release/`. `hosting-manifest.json` zahrnuje také otisky obou rezervovaných inicializačních souborů. Je nutné je zachovat při publikaci nové verze. Backendový balíček obsahuje pouze sedm vybraných vstupů a jejich importy, bez konfigurace pro široký deploy. Volba `--synthetic` je určena pro místní testy.
4. Po místní instalaci uzamčených závislostí ověřte `node tools/offline/verify-release-inventory.mjs --package <balíček>`. Kontrola načte skutečné exporty SDK ve třech režimech a ověří zachování obou Drive vazeb při zapnutém Drive. Připravené varianty Hostingu ověřte pomocí `node tools/offline/run-hosting-validation.mjs --artifacts <disabled> <enabled> <recovery> <původ>` na lokálním TLS. Opakujte pro druhý původ, pokud se má používat. Kontrola blokuje veškerý provoz mimo lokální Hosting.

## Po schválení

1. Potvrďte způsob zpřístupnění pěti nových HTTPS funkcí pro Firebase SDK. Pokud platforma vyžaduje změnu invoker IAM, vyžádejte její samostatné schválení. Přesný rozsah má pět vytvoření a dvě aktualizace `readQuizMedia` a `deleteEvent`. Nasaďte nejprve ve vypnutém režimu. U obou existujících funkcí měňte jen zdroj, zachovejte současné runtime identity, provozní konfiguraci, invoker a provoz na poslední revizi. Ověřte odmítnutí přípravy a běžné online přihlášení, přístupy a média.
2. Po schválení aktivace nastavte `JUSTKVIZ_OFFLINE_ENABLED=true` a `JUSTKVIZ_OFFLINE_EVENT_IDS` na 1 až 10 přesných ID existujících povolených akcí oddělených čárkou. Shodné hodnoty musí mít aktivní revize všech pěti offline Functions a `readQuizMedia`. V gateway zachovejte stávající konfiguraci Drive, identitu, ingress, dvě vazby Drive připnuté na dosavadní verze a parametry 512 MiB, 1 CPU, souběh 2 a maximálně 10 instancí. Nový podpisový klíč musí mít samostatnou schválenou správu, bez použití Drive klíčů. Binding připněte pouze ke dvěma uvedeným callable funkcím. Zachovejte současnou konfiguraci každé aktualizované funkce, včetně případných vazeb mediální brány. Zkontrolujte přesný seznam nasazovaných funkcí podle inventáře.
3. Nasaďte pouze Hosting na site `justkviz-v2` z ověřeného artefaktu. Zkontrolujte otisky, typ a čerstvost odpovědí offline souborů, CORS pro schválený původ, platný podpis, platný uzamčený snapshot a odpověď bez cache. Ověřte odmítnutí jiného účtu a jiné akce. Pro funkční zkoušku použijte výhradně předem schválenou izolovanou syntetickou akci.
4. Zopakujte průchod z návodu na cílovém notebooku a projektoru, včetně odpojení, restartu a potvrzení synchronizace. Praktická generálka je samostatná akceptace.

## Stažení funkce a náklady

Při problému nastavte `JUSTKVIZ_OFFLINE_RECOVERY_ONLY=true` na aktivních revizích všech pěti offline Functions a gateway. Ponechte `JUSTKVIZ_OFFLINE_ENABLED=true` a původní seznam povolených akcí pro oba synchronizační endpointy. Ověřte, že staré revize nepřijímají provoz a rozpracované přípravy doběhly. Použijte obnovovací Hosting. Obsluha může otevřít uložený průběh a synchronizovat ho v profilu, který má dříve ověřený veřejný klíč. V obnovovacím režimu je příprava nového profilu vypnutá. Při kritické závadě synchronizace pozastavte zápisy, ponechte uložené soubory a připravte kompatibilní opravu.

Předchozí Hosting lze obnovit na verzi zaznamenanou v připraveném manifestu. Chrome ukládá důvěru, stav a Service Worker odděleně pro `justkviz.cz` a `justkviz-v2.web.app`. Pro pokračování použijte stejný původ nebo předem připravený druhý profil. Nainstalované aplikace mohou běžet do konce místního oprávnění. Chrome aktivuje aktualizovaný Service Worker po zavření oken používajících starou verzi. Dříve připnuté veřejné klíče zůstávají v profilu. Před akcí proto ověřte i nezávislý cílový profil. Po výměně klíče otevřete starý průběh v dříve připraveném profilu. Nový balíček lze použít pro dosud neodehranou akci a zakládá vlastní historii.

Úplný balíček vyvolá až dva průchody 512 MiB médií přes Storage a odeslání 512 MiB přes gateway. K tomu se přidávají operace Firestore, běh Functions, přenosy Hostingu a případná cena secret bindingu nebo úložiště artefaktů. Limity velikosti a počtu souběžných instancí nejsou finanční strop. Dokud není pro konkrétní prostředky doloženo nulové navýšení, vydání a aktivace čekají na schválení.
