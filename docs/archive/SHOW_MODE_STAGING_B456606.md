# SHOW MODE b456606 — V2 staging, 15. října 2026

Verze `b4566066e72c423136a29733384280b7c0d42c0d` je nasazena na
[V2 staging](https://filmovy-kviz-v2-staging.web.app). Hosting i všech 44 schválených
Functions jsou ověřené. Hlavní SHOW MODE scénáře prošly serverovým i skutečným
browserovým ověřením na jedné izolované syntetické akci s deseti týmy.

## Schválení a preflight

Uživatel nejprve schválil Hosting a původních 28 Functions. Preflight přímým
čtením nasazeného backendu zjistil, že staging dosud nemá změny editoru,
zamykání vzhledu a PDF. Bez dalších 16 Functions by nový web ztrácel uložená
nastavení. Vlastník následně výslovně schválil **všech 44 Functions a Hosting**.

[Skutečný inventář nasazení](../tools/show-mode/staging-deployment-b456606.json)
obsahuje všech 44 názvů a jejich cloudové revize. Původní manifest 28 funkcí je
zachovaný jako historická evidence. Aplikační zdroj se při nasazování neměnil.
Pozdější dokumentační commit není novou nasazenou aplikační verzí.

Použit byl výhradně projekt `filmovy-kviz-v2-staging`, region `europe-west1`,
Node 22.23.2 a Firebase CLI 15.28.2. Byl ověřen cíl, přihlášený operátor,
potřebná již zapnutá API, konfigurace, aktuální Rules a neměnný build.
Lokální runtime ověření potvrdilo 44 exportů a 115 kontrolních součtů.
Předchozí lokální testy z [předání](SHOW_MODE_RELEASE.md) platí pro stejný zdroj;
bez změny implementace se neopakovaly celé sady.

## Výsledek nasazení

| Kontrola | Výsledek |
| --- | --- |
| Functions | 42 aktualizací + 2 nové, všech 44 ACTIVE / Gen2 / nodejs22 |
| Ostatní Functions | 31 beze změny plných metadat |
| IAM | 42 existujících politik beze změny; pouze invoker dvou nových callable služeb |
| Firestore a Storage Rules | Beze změny |
| Hosting | `a8e737029fb4a85f`, FINALIZED, zveřejněno 10:23:01.698 UTC |
| Hosting soubory | 39 souborů shodných s artefaktem + 2 zachované Firebase init soubory |
| HTTPS kontrola | Index, hlavní JS a CSS: HTTP 200, přesné bajty a bezpečnostní hlavičky |

Functions CLI skončilo exit code 2 kvůli lokální kontrole souběžného polleru
po dokončení aktualizace `updateQuizMetadata`. Neopakoval se žádný deploy.
Následná nezávislá kontrola potvrdila všech 44 aktivních funkcí, jejich aktuální
metadata a IAM. Zdrojové ZIPy `updateQuizMetadata` a `configureEventShow`
obsahovaly přesných 74 souborů shodných s artefaktem. Ostatní cíle byly ověřeny
metadaty a shodným deployment hashem; nestahovalo se všech 44 ZIPů.
Hosting CLI skončilo exit code 0.

## Skutečné online ověření

- SDK: 45 kontrol včetně výsledků 6+4, přesného návratu k odhalené otázce,
  sanitizace veřejného stavu, ručního TOP 3, dense remíz, deseti společných
  vítězů 6+4 a uchování staré verze po explicitní opravě skóre.
- Autorizace: anonymní přístup k soukromému kvízu, akci, relaci a staré verzi
  odmítnut; účet bez potřebného oprávnění nemohl ovládat SHOW ani číst jeho audio.
- Kompatibilita: vlastní vzhled a šablony uložené v editoru i zamčeném snapshotu;
  autorizovaný skutečný dvoustránkový PDF export týmových archů a WAV gateway.
- Browser: skutečná tlačítka moderátora, anonymní projektor, stránkování,
  statický režim, bulk nižších míst, 3 → sdílené 2 → 1, úplná tabulka a skrytí.
- Synchronizace a audio: reload bez samovolného zvuku, odpojený projektor skryje
  obsah, reconnect zachová revizi/cue; nativní dekódování a přehrání WAV,
  STOP odpojí audio výstup. Uloženo všech pět cue přiřazení.
- Obrazy průběžných výsledků, třetího místa a vítěze zachyceny v 1920×1080
  a 1280×720; lead vizuálně zkontroloval reprezentativní snímek každé scény.

První browserový běh se přerušil při snímku již potvrzeného vítěze (revize 30).
Původní helper neuložil konkrétní chybu, proto příčina není prokázaná. Úzké
pokračování zachovalo tutéž verzi, ověřilo snímek a zbývající ovládání do revize
35 bez dalšího spuštění finále. Původní neúspěšný záznam zůstává zachovaný.
Testovací relace `mvlSrdC6uApg0ptiX0G1` byla následně potvrzeně ukončena.
Syntetické záznamy zůstaly pro audit; nebyly odeslány emaily ani měněna členství.

Fyzický projektor, slyšitelnost reprosoustavy a konkrétní AV zapojení sálu nebyly
ověřeny. Ověřený zvuk běžel přes nativní Web Audio v Chromium.
V1 ani produkční projekt nebyly použity nebo změněny.

## Evidence

Pod `.local-data/show-mode-staging/` zůstávají `approval.json`,
`compatibility.json`, neměnný `release-b456606-proposal44/receipt.json`,
`functions-verification.json`, `functions-cli-reconciliation.json`,
`hosting-verification.json` a `deployment-verification.json`.

Podadresář `qa-reliability-b456606-20261015/` obsahuje SDK journal a receipt,
`compatibility-smoke.json`, oba browserové journals a receipts,
`finish-receipt.json`, PDF a šest snímků `ui-interim-*`, `ui-finale-*`,
`ui-winner-*`. Kontrolní součty vybrané konečné evidence jsou v
`final-evidence-manifest.json`. Privátní přihlašovací údaje nejsou součástí
manifestu, Gitu ani nasazeného artefaktu.
