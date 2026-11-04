# Ochrana osobních údajů — návrh k doplnění

Stav: lokální návrh, nezveřejněno jako konečné právní prohlášení. UI /privacy a registrační odkaz ukazují stav návrhu. Vlastník musí před veřejným spuštěním potvrdit správce/kontakt, právní důvody, retenci po kategoriích, příjemce/umístění/předání a postup žádostí.

| Ověřený zdroj | Skutečný rozsah |
|---|---|
| registrace validation/callables | název týmu, počet, email, stav, časy, private capability verifier a receipts; kontakt jen autorizovaně |
| public projection/results | veřejné event údaje a explicitně zveřejněné názvy/výsledky týmů, bez emailu |
| registration abuse | neveřejný event-scoped hash kontaktu a token bucket; bez IP, nezajišťuje vlastnictví emailu |
| Auth/access | staff UID/email, členství/oprávnění, audit; Auth není samo autorizací |
| email runtime/outbox | kontakty/obsah/zprávy pro zapnutého poskytovatele; vypnutí/unknown outcome brání automatickému replay |
| Drive/Gmail připojení | volitelné staff identity/OAuth metadata a šifrovaná oprávnění; účastník neuděluje Gmail/Drive přístup |
| retention | cancellation ani event completion samy nezpůsobí výmaz; schválená lhůta/automatické mazání chybí |

Neslibovat neověřenou evropskou lokalitu, trvalé mazání backupů nebo aktivní AppCheck/CAPTCHA. Zrušení účasti je jiné než výmaz osobních údajů. Žádosti se ověřují bez zasílání hesel a management capability. Retenční rozhodnutí musí zahrnout i audit, outbox, Auth a zálohy; restore nesmí vrátit již schváleně smazané údaje.

Před release doplnit veřejný kontakt pořadatele také do emailové šablony/stránek OAuth; osobní email/telefon není hardcoded v nově připraveném kandidátu. Staré veřejné/provozní verze se tím zpětně nemění.

Ověřené podklady: [Firebase privacy](https://firebase.google.com/support/privacy) pro role/provozní data a [DPC čl.13/14](https://www.dataprotection.ie/en/individuals/know-your-rights/right-be-informed-transparency-article-13-14-gdpr) pro obsah informace. Nejsou potvrzením konkrétní právní identity, konfigurace ani právního titulu tohoto provozovatele.
