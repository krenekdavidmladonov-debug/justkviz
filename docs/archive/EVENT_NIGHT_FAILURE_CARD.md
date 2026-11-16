# Event night: krizová karta

## Projektor se zavřel nebo není fullscreen

Z moderátorského okna znovu otevřete projector window, přesuňte je na rozšířenou HDMI obrazovku a fullscreen zapněte ručně. Když se stav neobnoví, použijte V1.

## YouTube nehraje

Zkuste jednou `STOP` a `REPLAY`. AUDIO otázka musí zůstat viditelná a vinyl stát; VIDEO se musí vrátit na otázku. Bez fyzicky ověřeného zvuku nebo obrazu použijte V1.

## Aplikace nebo stránka se obnovila

Obnovte nejdřív projektor a potom moderátora. Pokud se autoritativní session stav nevrátí nebo se ukáže starý obsah, nepokračujte ve V2.

## Internet vypadl

Zastavte médium, ponechte otázku zobrazenou a po návratu sítě proveďte jediný ruční retry. Při opakované chybě použijte V1.

## Lokální služby spadly

Nespouštějte seed ani přípravu dat. Spusťte znovu `START_EVENT_NIGHT.cmd`; launcher smí načíst jen poslední ověřený lokální snapshot. Pokud restart nebo verifier neprojde, použijte V1.

## Okamžitě přepnout na V1

Použijte `OPEN_V1_FALLBACK.cmd` při blockeru, chybě integrity či security, neověřeném snapshotu, opakovaném pádu, nefunkčním povinném médiu nebo při výsledku `NO-GO — USE V1`.
