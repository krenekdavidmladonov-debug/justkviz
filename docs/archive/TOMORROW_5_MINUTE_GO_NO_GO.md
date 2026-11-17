# Večer: 5minutový go/no-go

## Nejdřív dokončete obsah

1. Dvakrát klikněte na `START_TONIGHT_REPAIR.cmd`, přihlaste se zobrazeným demo admin účtem a ručně vyřešte všechny blockery přes **Uložit a pokračovat**.
2. Spusťte `VERIFY_TONIGHT_GO_NO_GO.cmd`. Pokračujte pouze při hlášce **V2 OBSAHOVĚ PŘIPRAVENA**; preflight musí mít **0 blockerů**.

## Fyzický test

3. Připojte HDMI, ve Windows zvolte **Rozšířit obrazovky**, otevřete projector window, přetáhněte ji na projektor a zapněte fullscreen.
4. Ověřte jedno skutečné AUDIO: fyzicky slyšitelný zvuk, správný START/END, STOP a animaci vinylu.
5. Ověřte jedno skutečné VIDEO: PLAY, STOP, konec ukázky a návrat na otázku.
6. Ověřte jeden RECAP: přehrávač od 0:00, timeline a správnou odpověď až po ručním reveal.

Pokud cokoli technického nebo fyzického selže, zvolte **NO-GO V2**, spusťte `OPEN_V1_FALLBACK.cmd` a použijte nedotčenou V1. Po práci vždy spusťte `STOP_EVENT_NIGHT.cmd`, aby se lokální opravy bezpečně exportovaly a zálohovaly.
