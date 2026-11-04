# Lokální pomocník JustKvíz pro Windows

Přenosná aplikace pro Windows x64. Nepotřebuje správce, instalaci Node.js,
lokální HTTP server, cloudový CLI, cookies prohlížeče ani přihlášení ke Google
Drive. Uživatel potřebuje oprávnění ke zdroji na YouTube. Klient přijímá pouze
YouTube ID a časový interval; žádný vzdálený příkaz, cesta nebo zdrojová URL se
nespouští. Drive přenos a konečné připojení média provádí důvěryhodný server.

## Příprava balíčku vývojářem (pouze offline)

```powershell
.\.tools\node22\node.exe tools\media-companion\package-runtime.mjs
.\.tools\node22\node.exe --test tools\media-companion\client.test.mjs tools\media-companion\protected-store.test.mjs
```

Výstup: `.local-data/media-companion/` (ignorováno Gitem). Kopírují se pouze
předem připravené a SHA-256 připnuté Windows nástroje: yt-dlp 2026.08.19,
FFmpeg/ffprobe 9.0.2 essentials a Node.js 22.23.2. Chybějící nebo změněný soubor
balení zastaví. Balíček obsahuje licence, kontrolní součty a
`runtime-manifest.json`. Při spuštění znovu ověřuje velikosti, SHA-256 a Windows
x64 hlavičky všech čtyř nástrojů. Žádný runtime se nestahuje ani neaktualizuje.
Balíček sám neobsahuje token, média, párování ani nastavení spouštění.

## První použití připraveného balíčku

1. Uložte celý adresář na stálé místo v uživatelském profilu; názvy cest mohou
   obsahovat mezery. Uložení na síťové disky nebo do sdílené zapisovatelné složky
   není podporováno.
2. V Nastavení → Google Disk vytvořte jednorázový párovací kód. Platí pět minut a lze jej použít
   pouze jednou. V PowerShellu spusťte `powershell -NoProfile -ExecutionPolicy
   Bypass -File .\Pair.ps1`, vložte kód a potvrďte Enter. Kód se při zadávání
   nezobrazuje. Nedávejte jej do argumentů příkazu nebo souborů.
3. Spusťte `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start.ps1`.
   Pomocník běží skrytě; skript vypíše jeho PID. V editoru uložte YouTube ID,
   START a END. Pomocník převezme nejvýše jednu úlohu, připraví MP3 nebo MP4
   a odešle ji serveru. Editor sleduje důvěryhodný stav zpracování.
4. Volitelně spusťte `Install-Logon.ps1`: vytvoří zástupce pouze pro aktuálního
   uživatele ve složce Po spuštění. Nic nespouští a nevyžaduje správce.
   `Remove-Logon.ps1` jej odstraní. Tyto kroky jsou ruční a balení je neprovádí.

Před novým párováním ukončete starý proces podle jeho PID ve Správci úloh.
Při zamítnutí přístupu 401/403 se pomocník zastaví a vyžaduje nové párování.
Zástupce lze ponechat; platnost oprávnění stále ověřuje server. Pro odpojení
zařízení odvolejte přístup v Nastavení → Google Disk a ukončete proces. Lokální identitu lze
poté odstranit smazáním jeho soukromé složky popsané níže.

## Soukromý stav a obnovení

Identita je uložena mimo repozitář a balíček v
`%LOCALAPPDATA%\JustKvizMediaCompanion\identity.dpapi`, zašifrovaná Windows
DPAPI pro aktuálního uživatele. Složka má chráněný ACL pouze pro jeho SID.
Token prochází do malého PowerShell procesu jen standardním vstupem; není v
argumentech, proměnných prostředí, prosté konfiguraci ani logu. Čitelný výstup
DPAPI se vrací pouze nadřazenému procesu do paměti. Kopie identity na jiný účet
nebo počítač se musí znovu spárovat.

Pomocník ukládá jednu soukromou kopii výsledku `pending.clip` s ověřeným hashem
a šifrovaným popisem lease. Přeruší-li se odpověď serveru po přenosu, po restartu
odešle stejné bajty. Nestahuje a nevytváří tentýž lease znovu. Kopii odstraní až
po jednoznačném `ready`/`failed`/`stale` nebo vypršení lease. Přerušení během
samotného zpracování vede k bezpečnému nahlášení chyby tohoto lease. Současně
nelze spustit dva pomocníky: soukromý procesní zámek to odmítne.

Trvalý stav je omezen na 25 MiB včetně rezervy 128 KiB na metadata. Výsledek
proto musí být menší než 24,875 MiB. Dočasný `scratch/` je oddělený pracovní
prostor ohraničený existujícím workerem: zdroje celkem nejvýše 200 MiB, výsledek
nejvýše 25 MiB, výřez nejvýše 180 sekund a celý proces nejvýše 420 sekund.
Pracovní soubory se vždy uklidí; po tvrdém ukončení se při dalším startu mažou
pouze ověřené vlastní adresáře `clip-*`. Neznámá položka nebo junction cleanup
zastaví. V takovém případě pomocníka ukončete a prověřte soukromou složku.

Síťové chyby opakuje s prodlevou 30 sekund až 5 minut, nečinné dotazování po
15 sekundách. Výpisy jsou jen pevné stavové kódy, bez URL, obsahu kvízu, jmen
souborů nebo pověření. Skrytý launcher výpisy nikam neukládá. Ctrl+C při
přímém spuštění zastaví dotazování; již zahájený výřez může dokončit bezpečný
úklid v rámci svého limitu. Vynucené ukončení procesem Windows je možné;
následující start pracuje s uloženým lease.

## Síťový kontrakt

Jediný povolený cloudový cíl je pevně zapsaný:
`https://europe-west1-filmovy-kviz-v2-staging.cloudfunctions.net/driveMediaCompanion`.
Technické jméno projektu odpovídá aktuální V2 službě. Redirecty jsou zakázané,
JSON odpověď je omezena na 16 KiB. Pomocník nečte Firestore nebo Drive a
nepřijímá URL pro upload.

Všechny požadavky jsou POST. Párování posílá JSON
`{action:'pair',code}` a obdrží `{token,deviceId,expiresAt}`. Ostatní požadavky
přidávají `Authorization: Bearer <token>`. Claim JSON `{action:'claim'}` vrátí
`{job:null}` nebo `{job:{quizId,slideId,field:'mediaSource',jobId,leaseId,
expiresAt,source:{type:'youtube',videoId,kind:'audio'|'video',startSeconds,
endSeconds}}}`. Časy vypršení jsou celočíselné epochové milisekundy. Job ID
je 64 malých hex znaků, lease je UUID v4 a quiz/slide ID jsou 1–150 znaků
`[A-Za-z0-9_-]`. Lokální konfigurace příkazů nepochází z tohoto kontraktu.

Výsledek je surový `application/octet-stream` na stejný endpoint s jedinými
query poli `action=complete&jobId=...&leaseId=...`. Chyba posílá JSON
`{action:'fail',jobId,leaseId,code:'processing-failed'}`. Výsledek operace
obsahuje shodný `jobId` a `status:'ready'|'failed'|'stale'` (server může přidat
`execution`, `reference`, `errorCode`; klient je nevypisuje). HTTP 409/410
znamená neplatný lease, 401/403 zastaví zařízení, 429/5xx opakuje přenos.

## Lokální syntetický emulátor

Pouze přímé spuštění nabízí oba explicitní přepínače:

```powershell
.\bin\node.exe .\tools\media-companion\client.mjs --pair --emulator-project demo-companion --emulator-port 5001
.\bin\node.exe .\tools\media-companion\client.mjs --emulator-project demo-companion --emulator-port 5001
```

Párovací kód se i zde čte pouze ze stdin. Cíl se sestaví výhradně jako
`http://127.0.0.1:5001/demo-companion/europe-west1/driveMediaCompanion`.
Soukromý stav používá oddělenou složku s demo ID. Jiné hosty, localhost,
projekty bez `demo-`, URL query, redirecty a libovolné endpointy klient odmítá.
Unit testy používají falešnou síť a stub workeru; DPAPI test na Windows šifruje
pouze syntetický token v ignorované dočasné složce a ověřuje ACL. Nespouštějí
YouTube, cloudový endpoint, Drive zápis ani automatické přihlášení.
