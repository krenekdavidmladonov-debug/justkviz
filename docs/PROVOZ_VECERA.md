# Provoz kvízového večera

## Co dnes použít na kvízový večer

Pro skutečný večer použijte **offline režim v aplikaci JustKvíz**. V detailu akce zvolte **Připravit offline kvíz**, uložte balíček `.justkvizoffline` a na notebooku pro večer vyzkoušejte **Spustit offline kvíz** s odpojenou sítí, projektorem a médii. Podrobnosti jsou v [návodu k offline režimu](archive/OFFLINE_MODE.md).

Skripty `tools/legacy/*EVENT_NIGHT*` použijte jen při cílené zkoušce starého lokálního profilu nebo při obnově jeho již připraveného demo snapshotu. Níže je návod výhradně pro tento profil.

## Starší lokální profil EVENT_NIGHT

Profil používá lokální build, Firebase Emulator Suite a projekt `demo-filmovy-kviz-v2` na loopbacku. Při běžném startu se data neseedují. [Lokální QA](LOCAL_QA.md) a tento profil používejte v různou dobu, protože sdílejí porty.

## Příprava

1. Jednou spusťte [PREPARE_EVENT_NIGHT.cmd](../tools/legacy/PREPARE_EVENT_NIGHT.cmd) z čistého připraveného commitu. Vyžaduje Node 22, pnpm, Javu 21 a Git. Ověří demo nastavení, sestaví build svázaný s daným commitem, připraví lokální demo účet a importuje čtyři offline kvízy.
2. Po ověření přihlášení a stavu vybraného kvízu launcher uloží snapshot do `.local-data/event-night/emulator-data/`. Existující snapshot příprava nepřepíše.
3. Připravte HDMI, rozšířenou obrazovku, napájení notebooku a připojení pro YouTube. Při večeru nechte notebook běžet bez uspání.

## Start a pětiminutová kontrola

1. Spusťte [START_EVENT_NIGHT.cmd](../tools/legacy/START_EVENT_NIGHT.cmd). Launcher ověří build, commit, snapshot a porty, vytvoří zálohu a otevře `http://localhost:5000/admin/login`.
2. Přihlaste se lokálním demo účtem. Pro opravy obsahu můžete otevřít lokální editor přes [START_TONIGHT_REPAIR.cmd](../tools/legacy/START_TONIGHT_REPAIR.cmd).
3. Spusťte [VERIFY_TONIGHT_GO_NO_GO.cmd](../tools/legacy/VERIFY_TONIGHT_GO_NO_GO.cmd). K fyzické kontrole přejděte po výsledku `GO — V2 SOFTWARE READY FOR PHYSICAL CHECK` a při nulovém počtu blokujících problémů.
4. Otevřete okno projektoru, přesuňte je na rozšířenou obrazovku a zapněte fullscreen. Na místě ověřte slyšitelné AUDIO, VIDEO s návratem na otázku a jeden RECAP od 0:00.

Při výsledku `NO-GO — USE V1` nebo selhání fyzické kontroly spusťte ručně [OPEN_V1_FALLBACK.cmd](../tools/legacy/OPEN_V1_FALLBACK.cmd).

## Záloha a ukončení

- [BACKUP_EVENT_NIGHT.cmd](../tools/legacy/BACKUP_EVENT_NIGHT.cmd) exportuje běžící lokální data. Po ověření kontrolních součtů použije nový export a uchová předchozí ověřený snapshot v `.local-data/event-night/backups/`.
- Po večeru spusťte [STOP_EVENT_NIGHT.cmd](../tools/legacy/STOP_EVENT_NIGHT.cmd). Exportuje a ověří aktuální stav, uchová předchozí snapshot a ukončí pouze svůj ověřený pracovní proces.

## Když nastane problém

- **Projektor se zavřel nebo obnovil.** Znovu otevřete nebo obnovte projektor, potom případně obnovte moderátora. Před pokračováním ověřte aktuální otázku a fullscreen na správné obrazovce.
- **YouTube nebo připojení selhalo.** Zastavte médium a ponechte otázku zobrazenou. Po obnovení připojení zkuste přehrávání jednou zopakovat. Při opakovaném selhání povinného média použijte V1.
- **Lokální služby spadly.** Znovu spusťte start a ověření. Při přerušené výměně snapshotu použije start jen ověřenou zálohu uvedenou v `.local-data/event-night/promotion-pending.json`. Při neplatné evidenci nebo poškozeném snapshotu se zastaví. Nespouštějte přípravu ani seed jako obnovu. Změny od posledního úspěšného exportu může být třeba zadat znovu.
- **Restart, integrita nebo zobrazení se nepodařilo ověřit.** Použijte V1 a zachovejte lokální data pro kontrolu.

## Podklady

- [Lokální provoz](archive/EVENT_NIGHT_LOCAL.md), [pětiminutová kontrola](archive/EVENT_NIGHT_5_MINUTE_CHECK.md) a [krizová karta](archive/EVENT_NIGHT_FAILURE_CARD.md) popisují původní postupy.
- [Akceptace restartu](archive/EVENT_NIGHT_RESTART_ACCEPTANCE.md) ověřila export a obnovu s izolovanými demo daty. Na místě ověřte vlastní zálohu, obraz a zvuk.
- [Archivní checklist vydání](archive/EVENT_NIGHT_RELEASE_CHECKLIST.md) zachovává dřívější rozsah vydání a jeho kontroly. Pro nasazení platí [AGENTS.md](../AGENTS.md).
