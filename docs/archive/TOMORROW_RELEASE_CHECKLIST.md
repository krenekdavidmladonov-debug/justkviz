# Zítřejší release a provozní checklist

Tento checklist je pro jeden konkrétní, předem připravený kvíz. Nezačínejte živý kvíz s jediným blockerem. Kvíz s online médii může po odstranění všech blockerů zůstat ve stavu `READY_WITH_WARNINGS`; před startem je nutné dokončit níže uvedenou lidskou kontrolu a warnings vědomě potvrdit.

## BEFORE EVENT

- [ ] Spusťte `START_LOCAL_QA.cmd` dvojklikem a počkejte na zelenou zprávu, že platforma běží.
- [ ] Otevřete `http://localhost:5173/admin/login`, přihlaste se lokálním admin účtem z okna launcheru a ověřte knihovnu kvízů.
- [ ] Pro lokální rehearsal s migrovanými kvízy nejdříve ponechte launcher běžet a v PowerShellu z rootu projektu spusťte:

  ```powershell
  & .\.local-data\local-qa\bin\pnpm.cmd --filter @filmovy-kviz/migration-v1 build
  & .\.tools\node22\node.exe .\tools\local-emulator-environment.mjs firestore .\tools\migration-v1\lib\cli.js emulator
  & .\.tools\node22\node.exe .\tools\local-emulator-environment.mjs firestore .\tools\migration-v1\lib\verify-emulator.js
  ```

  Pokračujte pouze při `PASS` a součtech 4 / 315 / 23 / 263 / 263 / 154. Příkazy jsou emulator-only a vyžadují `demo-*`; historická data neopravují.
- [ ] Jako nejrychlejšího kandidáta vyberte migrovaný kvíz s 5 koly a 50 otázkami. Aktuální sanitizovaný preflight: 16 blockerů (15 ANSWER, 1 TIMING) a 26 warnings. Názvy, odpovědi ani media URL nejsou součástí reportu.
- [ ] Otevřete `Připravenost`. Každý blocker opravte přes jeho odkaz do přesné otázky. Pořadí: správná odpověď → AUDIO/VIDEO start/end → médium → povinný obrázek → struktura.
- [ ] Každou změnu explicitně uložte. Po dávce oprav znovu spusťte readiness; nespoléhejte na lokální preview jako na uložený stav.
- [ ] Cíl: 0 blockerů. U online médií přijměte `READY_WITH_WARNINGS` až po dokončení následující 15–20minutové kontroly.

### Real YouTube QA — maximálně 15–20 minut

- [ ] AUDIO: otevřete jednu skutečnou YouTube otázku, ověřte start/end, `PLAY`, `STOP`, `ZNOVU` a že projektor ukazuje pouze vinylovou animaci, ne video player.
- [ ] VIDEO: otevřete jednu skutečnou YouTube otázku, ověřte start/end, `PLAY`, `STOP`, `ZNOVU`; po stop/end/chybě se musí vrátit otázka.
- [ ] RECAP: vyberte AUDIO nebo VIDEO otázku mimo pořadí, zobrazte odpověď a ověřte normální YouTube player od 0:00 včetně seek/timeline.
- [ ] Projector: otevřete samostatné okno, přepněte fullscreen, obnovte stránku a znovu je otevřete z moderátora. Aktuální stav se musí obnovit z Firestore.
- [ ] Pokud jediný krok selže, nepovažujte media kvíz za připravený; použijte předem dohodnutou nemediální variantu nebo danou otázku vynechte.

## AT VENUE

- [ ] Připojte napájení notebooku a HDMI před spuštěním aplikace.
- [ ] Ve Windows nastavte `Rozšířit tyto obrazovky`, ne duplikování.
- [ ] Otevřete projektorové okno na externím displeji a zapněte fullscreen.
- [ ] Ověřte správný HDMI/venue audio výstup a bezpečnou hlasitost.
- [ ] Ověřte stabilní internet skutečným přehráním jednoho AUDIO a jednoho VIDEO zdroje; pouhé načtení stránky nestačí.
- [ ] Zakažte uspávání notebooku a automatické restarty po dobu akce. Launcher ani emulatorové okno během hry nezavírejte.

## BEFORE START

- [ ] Přihlaste se, otevřete pouze schválený kvíz a znovu potvrďte 0 blockerů na uložené revizi.
- [ ] Otevřete moderátora a samostatný projektor; zkontrolujte černé pozadí a správný poměr 16:9.
- [ ] Proveďte jeden krátký AUDIO test: `PLAY` → `STOP` → `ZNOVU`.
- [ ] Proveďte jeden krátký VIDEO test: `PLAY` → `STOP` → návrat otázky → `ZNOVU`.
- [ ] V RECAPu vyberte jinou otázku, odhalte odpověď a ověřte player od 0:00; potom se vraťte do výchozího stavu.
- [ ] Ověřte `NEXT` a `PREVIOUS` přes hranici dvou sousedních slidů. Správné odpovědi se během kola nesmí zobrazit.

## FAILURE FALLBACK

- [ ] YouTube chyba: stiskněte `STOP`, vraťte otázku, nepokoušejte se opakovaně rychle spouštět player; otázku přečtěte nebo ji podle předem připraveného moderátorského plánu vynechte.
- [ ] Výpadek internetu: pokračujte jen s otázkami, jejichž obsah je už skutečně dostupný; AUDIO/VIDEO ani externí obrázky nejsou offline garantované. Přejděte na nemediální náhradní otázku nebo ruční moderování.
- [ ] Zavřené projektorové okno: v moderátoru zvolte znovu otevření projektoru, přesuňte okno na externí displej a zapněte fullscreen. Před pokračováním ověřte aktuální slide.
- [ ] Refresh aplikace: obnovte moderátorskou stránku, případně se znovu přihlaste, otevřete stejnou live session a ověřte Firestore stav; projektor podle potřeby znovu otevřete.
- [ ] Pád emulatorů nebo Vite: zastavte moderování a přejděte na ruční záložní průběh. `STOP_LOCAL_QA.cmd` ani nový seed během živé hry nespouštějte; restart lokálního emulatoru není obnova rozehrané session.
- [ ] Po skončení spusťte `STOP_LOCAL_QA.cmd` a potvrďte zelenou zprávu o bezpečném zastavení.
