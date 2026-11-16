# Owned media foundation

The current local multi-image backup is documented in [LOCAL_IMAGE_BACKUP.md](LOCAL_IMAGE_BACKUP.md). The phase 1 and phase 2 sections below retain their historical single-image contract and evidence.

The local candidate supports owned image, audio and MP4 uploads through the same private quiz editor and player contract. No deployment or migration is performed. Legacy HTTP and YouTube references retain their online behavior. The [complete offline event](OFFLINE_MODE.md) accepts owned Storage media only. Question, answer and background images keep independent roles.

## Data and immutable ownership

The reserved value quiz-asset:<quizId>/<sha256 assetId> occupies existing string fields: IMAGE questionImage, AUDIO/VIDEO mediaSource, or image answerImage/backgroundImage. No signed URL, access token, local Blob URL or file bytes are persisted in a slide/publication. The server derives assetId from quiz/admin/request ID. The private document at quizzes/{quizId}/mediaAssets/{assetId} records quizId, assetId, kind, contentType, size, createdBy, createdAt, uploadExpiresAt, fingerprint and status. Finalization adds readyAt and the immutable Storage object generation.

Ready files use `quiz-assets/{quizId}/{assetId}/source`. MP4 uploads first use the separate `upload` object for that same grant; the client cannot create the canonical video object. Rules require the upload destination to be absent, so a second byte upload is denied even before finalization. Ready source objects cannot be overwritten or deleted by clients. Existing event locking copies the reference into the immutable snapshot; subsequent library edits choose a new reference. Metadata and object are retained even if the library question stops using them. There is no automatic physical cleanup, orphan sweep or bucket lifecycle rule. Retention/cleanup is a future decision requiring snapshot-aware reference analysis.

## Upload boundary

1. beginQuizMediaUpload requires a fresh enabled, verified Auth account, an active membership with `quiz.media.upload`, scope for the existing quiz, and a valid session cutoff. The same content transaction rereads membership and scope, then creates a 30-minute upload grant bound to that membership version and one exact actor, quiz, asset, path, MIME and size; request-ID reuse with different declared metadata is rejected.
2. Storage Rules permit only create under that server-issued grant. They read exactly two distinct Firestore documents: the current membership and the upload grant. They retain verified-token, active UID, session cutoff, current upload permission/version, actor/quiz/asset, uploading status, expiry, size and supported MIME checks. The grant is proof of the transaction's scope authorization; an additional quiz-root read for `own` scope would exceed Storage's two-document cross-service limit. Scope/permission changes through the membership boundary increment version and revoke pending grants. All direct get/list/update/delete remain denied, including staff.
3. `finalizeQuizMediaUpload` reauthorizes current membership, upload permission and quiz scope, and verifies actual MIME, size and signature. MP4 finalization reserves one writer in Firestore, verifies the staged generation and SHA-256, and writes a new canonical object with clean metadata. It verifies the canonical bytes, removes only the matching temporary upload, confirms its absence, and rechecks authorization before marking the canonical generation ready. A retry can verify an existing canonical copy, but cannot overwrite it or take over an unfinished write. If the writer stops before creating that copy, start a new upload. The existing image/audio path still requests removal of Firebase download tokens; the local Storage emulator can retain previously issued transport tokens on that legacy path. The app does not persist or publish those tokens.
4. Editor create/update and event locking verify every owned reference is ready, belongs to that quiz and has the correct kind. Conflicting roles, arbitrary paths and use in unsupported fields are rejected.

Supported uploads: PNG/JPEG/WebP up to 10 MiB per image; MP3/WAV and MP4 up to 25 MiB per file. MP4 uses `video/mp4` without additional content encoding. SVG, HTML and other upload formats are rejected. The MP4 signature verifies its container, not its codec. Offline preparation separately requires Chrome to decode the video and report positive picture dimensions, so an audio-only MP4 cannot pass as a video. No transcoding service is introduced.

There is currently no application API for transferring quiz-root ownership or physically deleting a quiz root. The two-read grant boundary assumes that invariant. Any future authorized ownership-transfer/root-deletion operation must invalidate pending media grants in the same transaction before it becomes available. Out-of-band privileged root changes are not detected by this Storage create condition; finalization and the read gateway still reauthorize current quiz scope. This is a bounded pending-upload capability, not authority to read, attach or publish media.

The editor prevents save, keyboard save, selection and structural mutations while upload is pending. After successful preparation it updates the local draft; explicit Save commits the binding. Abandoning a draft never physically deletes its uploaded object.

## Reads and reveal

readQuizMedia serves only GET, with nosniff/no-store and bounded single-byte Range support. Staff reads require a verified token, a fresh enabled Auth account, and current membership permissions and quiz/event scope for the requested media role. A public request includes sessionId; the server authorizes the exact reference against the current active publicSessions projection and checks its actual asset kind. It repeats that authorization after Storage IO. An unrelated reveal revision does not revoke a still-visible image; navigation, results presentation and session ending do.

Ordinary AUDIO is absent from the public payload and cannot be downloaded through the public endpoint. The moderator device fetches it with staff authentication. A specifically selected recap exposes that audio to the existing public projector. No public client lists Storage or reads private quiz metadata. A displayed public asset can of course be copied by a viewer; this is reveal timing/access control, not DRM.

The gateway reads a pinned object generation. Clients create in-memory Blob URLs, abort pending reads and revoke URLs on replacement/unmount. No durable media cache or bearer download URL is added. Network loss retains the existing projector disconnect behavior.

## Místní záloha médií · etapa 1

Na detailu uzamčené demo akce slouží **Připravit místní zálohu** k ověření jednoho syntetického PNG otázky. `readLocalEventMediaManifest` je určený výhradně pro projekt `demo-filmovy-kviz-v2` v emulátorech Functions, Auth, Firestore a Storage na loopbacku. Vyžaduje aktuální členství, `event.read` a `event.export` v rozsahu akce. Server vybere aktuálně přiřazený uzamčený snapshot, ověří generaci objektu a přesné známé SHA-256 syntetického PNG. Použití stejné reference v jiném poli nebo snímku ji vyřadí. Údaje z odpovědí se nepřenášejí. Po čtení Storage následuje nová kontrola účtu, oprávnění, snapshotu a generace.

Prohlížeč stáhne ověřený obrázek stávajícím soukromým `readQuizMedia` s parametrem `snapshotId`. Vyžaduje plnou odpověď 200, `no-store`, shodu ETag, typu, velikosti i SHA-256. Soubor `.justkvizbackup` obsahuje značku formátu, omezenou JSON hlavičku a bajty jediného PNG. Zůstává na disku v umístění zvoleném operátorem. Pilot neukládá soubory ani úchyty v OPFS, IndexedDB či Cache API. Formát se neotevírá jako webová stránka ani náhled obsahu.

Tam, kde prohlížeč nabízí nativní uložení, se zápis potvrdí až zavřením streamu a aplikace soubor znovu přečte. Při přerušeném zápisu se pokus zruší. Při běžném stažení prohlížečem se stav **Připraveno** objeví až po ručním otevření uloženého souboru. Po restartu prohlížeče operátor otevře stejnou akci, přihlásí se a vybere soubor z disku. Stav připravenosti znamená poslední úspěšné ověření proti čerstvému manifestu. Jiný snapshot, účet nebo verze členství, nedostupný manifest či uplynutí platnosti znamenají neplatný výsledek. Platnost končí šest hodin po plánovaném začátku nebo ukončením provozního stavu akce. Fyzický soubor zůstává pod kontrolou operátora, který ho po zkoušce smaže. [File System Standard · createWritable](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable)

### Opakování pilotu

Sestavte web s místními demo hodnotami z `apps/web/.env.example`, včetně `VITE_FIREBASE_PROJECT_ID=demo-filmovy-kviz-v2` a `VITE_FIREBASE_USE_EMULATORS=true`. Použijte Java 21 a Chromium pro Playwright nebo nainstalovaný Chrome přes `PLAYWRIGHT_EXECUTABLE_PATH`. Test vytvoří vlastní syntetickou akci a média.

```powershell
pnpm check
pnpm test:unit tests/localEventMediaBackupFile.test.ts tests/localEventMediaManifestGuard.test.ts
pnpm exec firebase emulators:exec --only auth,firestore,functions,hosting,storage --project demo-filmovy-kviz-v2 "node tools/local-emulator-environment.mjs full node_modules/@playwright/test/cli.js test --config tests/browser/local-media-backup.config.ts"
```

Prohlížečový test uloží skutečný soubor a ověří ho v novém procesu při blokované mediální bráně. Samostatně simuluje chybu kvóty a přerušení nativního zápisu. Ověření po restartu potřebuje manifest z emulátoru Functions a jeho kontrolní čtení Storage.

## Automatické použití místního PNG · etapa 2

V moderování demo akce lze přes **Načíst místní zálohu** otevřít soubor z etapy 1. Aplikace proti čerstvému manifestu ověří celý balíček a ponechá v paměti pouze jediný syntetický PNG otázky a jeho interní vazbu na snapshot. Experiment vyžaduje Chrome či Chromium, stejný notebook a projektor otevřený tlačítkem **Otevřít projektor** z tohoto okna moderování. Samostatná karta a nepodporovaná konfigurace vyvolají upozornění. Žádné nové soubory ani úchyty se trvale neukládají do prohlížeče.

Po ověření souboru následuje nová kontrola oprávnění a shody manifestu, teprve potom stav **Místní záloha ověřena**. Při přesunu moderování do další karty původní popup zavřete a otevřete projektor znovu z požadovaného okna, aby měl správný opener.

Síťové načítání začíná vždy první. Po 1 500 ms čekání nebo přenosové chybě sítě či HTTP 502, 503 nebo 504 může začít ověření místní kopie. HTTP 401, 403, 404, 410, 429, 500, neplatné bajty a neznámé chyby ji nepovolují. Stávající brána některé chyby Storage zakrývá odpovědí 404 a experiment toto odmítnutí respektuje. Pozdější úspěšná síťová odpověď vybraný místní zdroj nepřepne. Zamítnutí přijaté během síťového pokusu místní zdroj odstraní. Síťový pokus má stávající horní limit 15 sekund.

Projektor si sám před převzetím bajtů a znovu před jejich použitím načte veřejný stav ze serveru a zavolá demo-only `readLocalProjectorMediaAuthority`. Server v transakci porovná soukromou relaci s veřejnou projekcí, revizi, pozici, generaci přehrávání, aktivní relaci akce, aktuální uzamčený snapshot, roli otázkového obrázku, přesnou referenci a generaci objektu. Kontroluje i jednoznačnost reference v celém původním snapshotu. Rekapitulace, výsledky, odpovědi a jejich obrázky jsou z experimentu vyloučeny. Veřejná odpověď obsahuje pouze vazbu právě povoleného PNG, jeho známé SHA-256 a krátkou platnost.

Potvrzení platí nejvýše pět sekund. Při zobrazené místní kopii se zhruba každé dvě sekundy obnoví veřejné potvrzení i ověření operátora přes relay. Původní expirace běží i během čekání na obnovu. Chyba nebo vypršení kopii odstraní. Změna potvrzené relace, revize či generace přehrávání zruší čekající načítání a uvolní staré Blob URL. Stav Firestore z cache nebo událost offline vyčistí projektor stávající cestou.

Přenos používá jednorázový MessageChannel. Moderátor přijímá požadavky pouze z přesného spravovaného okna a originu. Každý požadavek má náhodné ID a krátkou platnost. Před odpovědí moderátor nově ověří aktuální `event.read` a `event.export`, verzi oprávnění a snapshot přes `readLocalEventMediaAuthorization` a veřejný tuple přes stejný autorizační endpoint. Toto ověření čte databázi, takže nevyžaduje dostupnou cestu k mediálním bajtům. Do projektoru odejde výhradně 84 bajtů PNG a veřejná vazba požadavku. Celý balíček, soukromý manifest, scopeKey, přihlášení a tokeny zůstávají v moderování. Projektor sám kontroluje velikost, PNG signaturu i SHA-256. Relay žádným způsobem nepublikuje stav relace.

Teprve po skutečném načtení obrázku přijde potvrzení z připnutého okna a moderování ukáže **Použita místní záloha**. Obrázek v projektoru má označení místního zdroje. Lokální bajty se nevkládají do sdílené mediální cache. Změna účtu, členství či relace ruší relay i čekající ověřování. Nové endpointy mají striktní demo/loopback pojistky a jsou výslovně vyloučeny z cloudového deployment manifestu.

Automatická sada používá `tests/browser/local-media-failover.config.ts` se stejnými demo emulátory a příkazem jako etapa 1. Měří skutečné PNG a popup prohlížeče. Zpoždění a transportní chyby jsou synteticky vložené pomocí Playwright. Fyzický projektor do měření nevstupuje.

### Lokální ověření 8. 11. 2026

Kód `7b395599fd76f1e89068e6e38d121e1f923ff984` prošel `pnpm check`, 1 439 unit/component testy, 13 prohlížečovými scénáři etapy 2, třemi scénáři etapy 1, dvěma předakcovými kontrolami a 64 testy Rules. Nezávislý audit SECURITY vydal PASS pro omezený demo experiment. Fyzický projektor a cloud mají SKIP.

Měření začíná těsně před skutečným `goToSlide` Callable a končí pozorováním dekódovaného obrázku v Playwright. Zahrnuje potvrzení navigace i režii kontrol DOM. Zpoždění brány je 3 500 ms, experimentální práh 1 500 ms. Každý profil má deset vzorků. p95 používá pořadovou metodu a při tomto počtu odpovídá maximu.

| Profil | Zdroj | Medián (ms) | p95 (ms) | Selhání |
| --- | --- | ---: | ---: | ---: |
| Rychlá brána, bez balíčku | online | 279,5 | 3 108 | 0/10 |
| Zpožděná brána, bez balíčku | online | 4 068 | 4 093 | 0/10 |
| Rychlá brána, načtený balíček | online | 290,5 | 300 | 0/10 |
| Zpožděná brána, načtený balíček | místní | 2 282 | 2 564 | 0/10 |

První síťový vzorek zahrnuje studený start mediálního workeru a má 3 108 ms. Profily běží postupně ve stejných emulátorech. Browser HTTP cache je vypnutá, stávající aplikační Blob cache se dál ověřuje na serveru včetně odpovědí 304. Žádný vzorek nebyl odstraněn. Předchozí neúplné a neúspěšné běhy se do tabulky nepočítají. Nové testy zachytily přetečení dlouhého časovače a nestabilní relay při rerenderu, obě chyby jsou opravené.

### Následující práce pro vlastní média

| Priorita | Rozsah | Podmínka přijetí |
| --- | --- | --- |
| P0 | Rozšířit jedno PNG na bounded manifest všech vhodných vlastních obrázků uzamčeného snapshotu. | Autoritativní digest a generace každého objektu, atomické uložení balíčku, limity bajtů a počtu, individuální stavy, žádné předčasné odpovědi. |
| P0 | Ověřit cílový notebook, prohlížeč a fyzický projektor při výpadku brány a odhlášení. | Změřit skutečný obraz, obnovu oprávnění a zneplatnění bez starého snímku. |
| P1 | Samostatně ověřit další vlastní obrazové formáty a velké soubory. | Testy paměti, dekódování, integrity, poškození a životnosti Blob URL. |
| P1 | Připravit samostatný experiment vlastního audia a videa. | Bounded stream/range, jeden přehrávač, zachování povelů, pozice a generace, bez duplicitního přehrávání. |
| P2 | Posoudit vlastněné Drive importy a provozní správu balíčků. | Výslovné právo k exportu, čerstvá oprávnění, odvolání, životnost a ruční odstranění souboru. |

YouTube, libovolné HTTP zdroje a cizí soubory vyžadují samostatně doložené oprávnění k místnímu uložení. Další formáty se touto etapou nezapínají.

## Player and UI compatibility

MediaPlayer selects the existing YouTube adapter or a native audio/video adapter, sharing the existing command/generation, reducer, callbacks and single-player budget. IMAGE uses the existing separate question/image contain layout with black bars. AUDIO remains manual: idle does not play; START/END apply to the ordinary question, STOP releases the prior player, REPLAY creates a new generation. Native pause reports ready and native resume reports playing for that same generation; stale and terminal callbacks remain rejected. Recap uses the existing playback plan from 0:00 without the ordinary END limit. Browser autoplay restrictions report an error and require a manual retry.

## Offline verification

Use only a demo-* project and local Auth/Firestore/Functions/Storage emulators. Any emulator signal requires an explicit localhost Storage endpoint; a missing Storage emulator cannot fall through to a configured cloud bucket. Test fixtures guard this before SDK initialization or synthetic writes.

- pnpm check
- focused media/model/player/legacy tests through pnpm test:unit
- pnpm test:rules
- firebase emulators:exec --only auth,firestore,functions,storage --project demo-filmovy-kviz-v2 "pnpm test:e2e:media && pnpm test:e2e:media-browser"

CI includes these Storage contracts and a synthetic browser upload/editor/projector flow. Existing browser groups remain enabled. The tests do not require cloud Storage, a Gmail account or real credentials.

The media emulator contract also evaluates the actual Storage Rules with the cached Rules runtime and synthetic cross-service documents, records the distinct requested paths, and imposes the cloud two-document budget in its adapter. A reconstructed prior `own`-scope condition must request three documents and fail that budget; current own/all/selected grant paths must permit with two. This is a source-bound regression for the documented budget, not a claim that the emulator itself reproduces every cloud quota or IAM/CORS behavior.

## Later authorized staging work

No staging configuration was changed. A separate approved deployment must select the exact reviewed SHA and V2 staging bucket, verify default bucket configuration and private bucket IAM, deploy the three endpoints and versioned Storage Rules, then test the cross-service Firestore Rules dependency and browser CORS in that environment. Review the documented Storage Rules service permission before any permission changes. Confirm tokenless reads, public reveal timing, immutable snapshots, bounded object sizes and HTTP response limits/cost at expected audience volume. No public bucket permission is required. No cleanup/lifecycle policy should be enabled implicitly.

References: [Storage Rules conditions and Firestore lookups](https://firebase.google.com/docs/storage/security/rules-conditions), [Storage emulator connections and limitations](https://firebase.google.com/docs/emulator-suite/connect_storage).

## Authoring extension

MediaUploadField is the single picker for upload, validated HTTP(S) link and ready assets of the current quiz. Images have separate question, answer and background roles; only background uses cover. Direct audio supports mp3/wav/ogg/m4a; video supports mp4/webm/ogv links, plus the existing YouTube parser. Codec/server availability is checked by the actual browser player. The ready-asset library displays up to 200 records; it is not a cross-quiz search.

A changed source clears START/END and requires a new valid interval. The unchanged imported 0/0 exception from PR #26 remains intact. Equal mapped media fields preserve their original representation; a changed empty string explicitly detaches a role and shadows legacy fallback without deleting its history. An upload cancellation invalidates late completions, and question selection/save are blocked during transfer. Grants/finalization time out after 30 seconds, transfer after two minutes, media reads after 15 seconds. Error/retry retains the draft.

See [MEDIA_AUTHORING_RELEASE.md](MEDIA_AUTHORING_RELEASE.md) for provenance, tests, rollout scope and component rollback. No cloud operation is performed by the build script.
