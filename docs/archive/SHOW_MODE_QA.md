# Show mode — QA před schválením návrhu

Stav 2026-10-15, Phase 1. Audit vychází z `be81596eab2646dfe7760f6ce7625f37e1909b6f`.
Produktová implementace show mode ani její schválení nejsou součástí tohoto důkazu.
Neproběhl deploy, cloudové čtení, emulátor ani práce s reálnými daty.

## Ověřený současný základ

Přímo spuštěný Vitest 4.1.11, nejvýše dva workery, prošel **11 souborů / 133 testů**.
Primární kompatibilní běh: `.tools/node22/node.exe` **v22.23.2**, start 10:36:49,
Vitest duration **10,01 s** (transform 772 ms, import 5,24 s, tests 5,25 s,
environment 829 ms). Předchozí běh Node v24.19.0 měl stejných 133 PASS / 11 souborů,
12,04 s. Node 24 není deklarovaný runtime Functions; kompatibilitu dokládá až Node 22.
Jde o testovací runtime, nikoli měření FPS nebo latence projektoru.

| Aktuálně spuštěné sady | Co tento důkaz pokrývá |
| --- | --- |
| `interimResults.test.ts`, `finalReveal.test.ts` | Dense ranking, součty půlbodů, chybějící versus nulové skóre, stabilní shody, fingerprint, skupiny a stránky, public parser |
| `fanfare.test.ts` | Tiché prepare, jednorázový klíč, odmítnutí audia, ruční retry, pozdní resume po STOP / ztrátě autority |
| `presentation.test.ts`, `presentationComponents.test.tsx` | Public/channel sanitizace, recap, A/V lifecycle, autoplay fallback, stale callbacks, 300 mediálních operací s nejvýše jedním playerem, index 315 slidů |
| `liveRepository.test.ts`, `liveSession.test.ts` | Cache odmítnutí, autorizovaný privátní odběr, odpověď až po reveal, allowlist designu/výsledků, monotónní revize a generace, 1000 přechodů |
| `slideDesignSecurity.test.ts`, `slideDesignRenderer.test.tsx` | Privátní answer design, bezpečné styly, původní rank/name/halfPoints pod vlastní šablonou, žádná canary v public mapování |
| `printCenter.test.ts`, `printCenterSecurity.test.ts` | Deterministický tisk a minimální print model, soukromé odpovědi, práva dokumentů, frozen template |

Reprodukce: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts`
s uvedenými 11 cestami pod `tests/` a `--maxWorkers=2`; použít Node 22.
V tomto Windows sandboxu bylo nutné nastavit `TEMP` a `TMP` na zapisovatelný lokální
scratch adresář. Pro další běh použít `.local-data/show-mode-review/qa/tmp`.
Původní sandboxové temp selhalo na `EPERM rename` před importy: 11 failed suites,
**0 spuštěných testů**, duration 6,12 s; vypnutí fsModuleCache nepomohlo (5,77 s).
První `pnpm exec` se pokusil obnovit závislosti a skončil na EPERM store symlink;
žádný test nespustil. Přímý entrypoint a lokální temp problém vyřešily bez změny závislostí.
Žádný z těchto běhů neověřuje budoucí show mode.

Historický důkaz v `WHOLE_EVENING_DESIGN.md`: 557 unit testů / 53 souborů,
50 Rules testů a browser journey na `2067f9b` dne 2026-10-14. Dokumentované
měření `03476da` versus tehdejší integrace zahrnuje Next → projektor medián
402 / 434 ms. Je to starší jiný rozsah; nelze jej vydávat za aktuální show-mode
baseline. Browser sady `final-reveal.spec.mjs`, `interim-results.spec.ts`,
`projector-lifecycle.spec.ts` a `projector-recap-authority.spec.ts` byly nyní pouze
čteny, nikoli znovu spuštěny. Rules a úplný `pnpm check` nyní také neběžely.

## Konkrétní mezery a rizika implementace

1. **Přesný návrat vyžaduje nový serverový kontrakt.** Současné
   `controlFinalReveal` a interim publication/hide používají `go-to-slide` na stejné
   pozici; `applyLiveSessionAction` resetuje reveal, recap selection a média.
   Nestačí znovu zobrazit stejný index. Požadované zachování již výslovně odhalené
   odpovědi / vybraného recapu musí vycházet ze serverem zachyceného privátního
   return intentu a čerstvého `buildPublicSessionState` allowlistu. Neukládat raw
   public response pro pozdější vrácení ani důvěřovat klientským reveal flags.
   Média se vracejí idle s novou generací, bez autoplay. END/cancel/archive a
   změněná vazba/snapshot nesmějí starý intent znovu publikovat.
2. **Dnešní public model obsahuje pouze aktuální stránku.**
   `publicFinalPage` řeže maximálně osm řádků právě odhaleného ranku;
   `parseFinalPage` odmítá extras, budoucí intro rows a smíchané ranky.
   Podium ani animace nesmějí vyžádat kompletní privátní tabulku pro přednačtení.
   Public `groupSize` dovoluje text o sdíleném vítězství i na stránce s jedním týmem.
   Pokud návrh chce zároveň více dříve odhalených ranků, musí mít samostatně
   posouzený omezený serverový payload; dnešní komponenta je sama nedostane.
3. **Shoda není pořadí jednotlivých týmů.** `calculateResults` dává 1/2/2/3;
   `revealRanks` odhaluje skupiny 3 → 2 → 1, stabilní NFC name/ID pouze řadí uvnitř
   shody. Podium nesmí přejmenovat čtvrtý tým na 4. místo ani zvolit jediného vítěze.
4. **Zvuk je lokální vedlejší efekt iniciujícího moderátora.** `Fanfare` a
   `FinalRevealPanel.playConfirmed` používají explicitní akci, epoch a čerstvou
   serverovou transakci. Animace/mount/snapshot/reconnect nesmějí spustit starý cue.
   Při novém typu cue zachovat STOP, mute/volume, ztrátu autority a pozdní resume
   ochrany. Potvrzený callable příkaz sám nedokazuje slyšitelný výstup.
5. **Ztráta spojení musí zrušit i lokální animaci.** `ProjectorPage` dnes čistí
   state při offline/error, odmítá starší revize a cizí session a reconnect čte ze
   serveru. Show-mode timer/RAF nesmí po clear ještě vykreslit starý tým nebo cue.
   Obnovení stejné revize má zobrazit konečný autorizovaný stav bez replaye.
6. **Vzhled už má bezpečnou dědičnost.** `publicResultTemplate`, `slideDesignStyle`,
   `ResultBackdrop` a `ResultBrand` přenášejí omezené barvy/font/logo/pozadí.
   Nový pohled musí převzít tuto cestu a frozen snapshot, aby vlastní šablona
   nezměnila skóre a nepřenesla answerDesign nebo soukromý asset.

## Akceptační matice pro implementaci po schválení

| Oblast | Konkrétní test / očekávaný výsledek | Vrstva a současný opěrný bod |
| --- | --- | --- |
| Tři navržené pohledy | Každý ukáže jen svůj schválený obsah; 1920×1080 i 1280×720, dlouhé české názvy, žádné překrytí skóre/logo | Screenshot + geometrie v browseru; doplnit až vzniknou tři návrhy |
| Průběžná stránka | 1, 6, 7, 8, 9, 12, 13, 1000 týmů; SHOW má šest řádků, klasické staré verze osm podle explicitního kontraktu; další stránka nepředteče do sítě/DOM | `calculateResults`, `parseResultPage`, raw anonymní HTTP payload |
| Shody / podium | 1/2/2/3, 1 tým, všichni první a 10 spoluvítězů přes dvě stránky; jeden reveal na rank, plural podle celé skupiny | `advanceFinal`, `publicFinalPage`, `FinalRevealView`; browser všechny stránky |
| Prázdná/neúplná data | Null/missing není nula; publikace odmítnuta; desetinné body z celočíselných půlbodů správně | `calculateResults`, `calculateFinalResults` + callable emulator po implementaci |
| Public privacy | Canaries ve future rows, private answer/design/note, contact, team ID a raw legacy nejsou v HTTP, DOM, title ani CSS | Rozšířit `tests/e2e/final-payload.mjs` a strict parsery; nespoléhat jen na screenshot |
| Přesný návrat | Běžný slide, explicitně revealed otázka, vybraný recap, round intro; zachovat identitu/pozici a dovolenou reveal/recap intent, dědičný vzhled | Nové pure server intent testy + transakční emulator + browser před/po show mode |
| Mediální návrat | Vstup při VIDEO/native AUDIO/YouTube AUDIO; show mode odstraní player, návrat idle/new generation, starý ENDED/PLAYING ignorován | `mediaStateMachine`, `recordPlayerLifecycle`, `liveSession`, reálný browser lifecycle |
| Reconnect / reload | Offline clear; během výpadku hide/nová stránka/nová verze/END; online pouze čerstvý stav; stejná revize obnoví obsah bez cue | `ProjectorPage`, `liveRepository`, browser se zadrženými skutečnými Firestore bajty |
| Souběh / opravy | Dva panely, dvojklik, stale revision, idempotent retry, referee korekce; pouze platná immutable verze, žádné druhé odhalení | Existující callable revision/receipt/fingerprint; emulator po schválení |
| Zvuk | Autoplay denial, mute, změna hlasitosti, STOP během async resume; hide/END/replace/unmount ruší cue; druhý panel/reconnect/retry tichý | `fanfare.test.ts` + nativní Web Audio start/gain graf z `final-reveal.spec.mjs` |
| Skip / reduced motion | Klik „přeskočit“ okamžitě nastaví konečný autorizovaný obraz a zruší RAF/timer; reduce má bez čekání stejný výsledek; žádný nový reveal | Browser `reducedMotion: reduce`, kontrola computed animation/transition + stav před/po |
| Vzhled | Custom color/font/background/logo, showLogo false, inherited i frozen design; answer override pouze již explicitně revealed answer | `slideDesignRenderer`, `slideDesignSecurity` + skutečné decode owned asset v browseru |
| Konec / hranice | Finish animace/zvuku nikdy nevolá END; END/cancel/archive čistí show payload i return intent; revoked membership/scope nemůže mutovat | Emulator authz/rules a výsledkový lifecycle; až s produktovým kódem |
| Klávesnice / obsluha | Fokus na reálném ovladači, čitelné disabled/busy/error, klávesnice neprovede dvojí příkaz; návrat a skip bez pasti | Moderátor 768 px a obvyklý desktop v browseru |

## Read-only kontrola vizuálního prototypu

Prohlédnuté `apps/web/src/show-mode-preview/{main.tsx,fixtures.ts,preview.css}`
oddělují syntetický návrh od produkčních routes a Firebase. Otázka na pozadí má
prázdná média a žádnou odpověď. Finále v JSX vybírá pouze rank >= již odhalený rank;
reduced motion a Skip ruší CSS animace, skóre se formátuje ze zadané půlbodové hodnoty.
Zvuk je poctivě označen nepřipojený. To je kontrola zdroje, nikoli browserový PASS.

Návrh interim používá šest řádků, zatímco dnešní server používá osm; po schválení
musí být velikost stránky jednotná ve výpočtu, pointeru, parseru i rendereru.
Pravý panel „Už známe“ ve finále kombinuje dříve odhalené ranky a má vlastní
stránkování po šesti řádcích včetně ovladače další stránky. Nejde o pevný slice,
který by zbývající nižší pořadí ztratil. Prototyp obsahuje i start od posledního
ranku a dense přepočet společných vítězů. Dnešní `publicFinalPage` kombinovaný
seznam dřívějších ranků neposílá. Skupiny featured/winners v návrhu
nemají vlastní stránkování a fixture má nejvýše tři spoluvítěze. Scénář 10+ týmů
na stejném místě proto zatím není doložen a vyžaduje další návrh stránky.

Nezávislá vizuální kontrola přes `view_image`: **PASS pro všech šest finálních
snímků** `.local-data/show-mode-review/{interim,finale,winner}-{1920,1280}.png`.
V obou rozlišeních jsou názvy, pořadí i půlbody čitelné, zarovnané a bez kolizí.
Interim zachovává viditelné 1/2/2/3 a jasně odděluje výsledky od ztlumené otázky.
Finále odděluje právě odhalené 3. místo od již známých 4.–9. a zobrazuje stránku
1/2; budoucí první a druhé místo na snímku nejsou. Vítězný název i skóre se vejdou
do canvasu, číslo 1 a žlutý akcent mají jednoznačnou hierarchii. Žádný blokující
vizuální nález pro tyto dodané fixtures. Drobné podpůrné popisky nejsou důkazem
čitelnosti ze zadní řady sálu; extrémně dlouhé názvy a 10+ shod tyto snímky neověřují.

Přečtený `capture.json` uvádí Chromium **151.0.7922.34**, čas
2026-10-15T08:40:48.398Z, přesné canvasy 1920×1080 / 1280×720, všech šest
`overflows: []`, `errors: []` a `nonlocalRequests: []`. Je to doklad od capture
harnessu doplněný výše uvedenou nezávislou kontrolou pixelů; nikoli plný funkční
browser test nebo performance měření. Performance důkazy vede vedoucí; tento
soubor žádné zatím nezměřené hodnoty nepřisuzuje prototypu.

## Srovnatelné měření před/po

Pro Phase 1 použít skutečný prohlížeč s produkčním preview a syntetickými daty.
Ve stejném browser procesu a viewportu porovnat stávající `SlideRenderer`
se samostatným prototypem; zaznamenat commit, čistotu zdroje, build, Node/browser
verzi a executable/hash, OS/CPU/GPU, headless/headed, viewport/DPR a refresh rate.
Použít stejné fonty, dekódované pozadí a délky názvů; oddělit cold decode od warm.
Střídat baseline/prototype, aby pořadí běhu neznamenalo automatickou výhodu.

Každý scénář zahřát, pak alespoň 30 přechodů: vstup/výstup, změna stránky,
jednotlivý rank, shoda přes stránku, winners, skip a reduce. Uvést surové vzorky,
medián, p95 a maximum; malé n nepovažovat za spolehlivý p99. Měřit input → první
paint/konečný paint, RAF frame intervaly, počet/délku long tasks, DOM node count
a player lifecycle. RAF mezery jsou indikátor hlavního vlákna, nikoli důkaz
skutečné GPU prezentace ani FPS na projektoru. Cold start zaznamenat zvlášť.
Po 100 cyklech ověřit, že nezůstávají animace, timery, Web Audio grafy ani playery;
heap má smysl porovnat jen při shodném GC protokolu, nikoli náhodným vzorkem.

Předběžný cíl pro schválení: skip/reduce nečeká na délku animace; žádný nový
long task nad 50 ms připsatelný efektu; vizuálně žádná soustavná ztráta snímků.
Přísný relativní latency budget stanovit až ze skutečné distribuce baseline.
Lokální prototyp bez serveru neověří callable→Firestore→projector latenci,
transakční souběh ani reálné odpojení. Po implementaci proto zopakovat plný
moderátor→anonymní projektor scénář proti demo emulátorům.

Automatický Chromium screenshot ani Web Audio graf nenahrazuje slabší notebook,
HDMI/rozšířený displej, fullscreen, vzdálenost v sále a poslech. Před použitím
ověřit skutečnou čitelnost, kontrast, plynulost a hlasitost na cílovém zařízení.
V tomto auditu nebylo měřeno žádné FPS, GPU vytížení ani fyzický zvuk.
