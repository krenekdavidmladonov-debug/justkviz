# Dokončená čtecí kontrola metadat syntetických médií

Stav k 2026-10-13: **SCHVÁLENO, PROVEDENO; METADATA OBOU OBJEKTŮ PASS.** Vlastník odpověděl na konkrétní otázku k tomuto návrhu: **„Schvaluji čtení těchto dvou souborů na 30 minut“.** Souhlas pokryl přesně zde vymezenou dočasnou podmíněnou roli pro stávajícího ověřeného operátora a dva syntetické objekty. Historický 403 zůstává zachovaný; nový výsledek pochází ze skutečných GET přesných generací.

## Výsledek schváleného provedení

Lead ověřil čerstvé původní etag/policy a připravil plán `db53252056ec48ac4a85f260a9bf49309ca54e0560ddfd0c30b67c76a97182d9` v `2026-10-13T06:22:09.545Z`. Pevná expirace je **`2026-10-13T06:52:09.545Z` / 08:52:09 Europe/Prague**. Proběhl jediný IAM PUT v 06:25:45Z; ostatní tři bindings, uniform bucket-level access a public access prevention byly zachovány. Původní execution helper SHA-256 `707da5f1d4bf98bc91b6a36996c00ab413eb8442dad9363e8a6b8a4907918fdd`, 25 cílených testů PASS. Žádný opakovaný zápis ani prodloužení.

První apply a reconcile skončily neurčitým výsledkem/driftem, protože služba v novém bindingu změnila pouze ASCII velikost písmen stejného uživatelského e-mailu. Role, přesná podmínka, čas i všechny ostatní bindings souhlasily. Nový GET-only resolver přijímá pouze tento konkrétní rozdíl jednoho principalu; celou zbývající policy kontroluje přesným hashem. Lead provedl 10 cílených testů, HIGH nezávislé source/public review; žádný worker nečetl privátní identitu ani neprováděl cloud. Původní logy zůstaly nedotčené.

`metadata-access-readonly-resolution-result.json` končí **METADATA_READ_ONLY_RESOLUTION_PASS** v `06:30:43.451Z`, další cloud writes **0**. Obě generace, velikosti a MIME odpovídají tabulce; oba objekty mají `metadataKeys: []` a `downloadTokensPresent: false`. Helper SHA-256 `44fd9210d140e1d5df19e75783a8d3dac1e5281be0e45fd42ca38df8ca3e0e06`. Finální offline `metadata-final-verification.json`, SHA-256 **`bcedd3296c6a1ba0dfefa4dcc1a0d3c89f45a7f482ceda96bc5011109e7f92a6`**, váže 37 vstupů včetně původní historie; nečte privátní policy/principal a nenahrazuje cloudový readback. Podrobnosti vlastníků, zdrojů a omezení jsou v [QA záznamu](STAGING_QA_EXECUTION_DDB862F.md).

Tato vymezená staging fáze je dokončená, heartbeat **PAUSED**. Zachovat původní expiraci, data a apply-once fence. Expirovaný binding může zůstat v policy; odstranění není součástí tohoto provedení. Žádný cleanup, nové čtení po expiraci, nové přidělení ani rozšíření rozsahu.

## Přesné dva objekty

Projekt `filmovy-kviz-v2-staging`, bucket `filmovy-kviz-v2-staging.firebasestorage.app`, quiz `quiz_baba5c0ac925bc2f8ead8485651af958c9465e16719aa98a44c00e016375e32c`.

| Syntetické médium | Asset ID | Zachycená generation | Bajty |
| --- | --- | --- | --- |
| PNG | `967805e802c97d000adfb7da18235c557b220ac0d0bee2626475d7d8a1df3b22` | `1791849391879749` | 84 |
| WAV | `33d5b69f01c2bd4fe561a1cbcc8cde96d302983d09b1eebd81aec075649b0bd1` | `1791849400478039` | 64044 |

Každá přesná cesta je `quiz-assets/{quizId}/{assetId}/source`. Původní generace a velikosti z authoritative `ready` dokumentů nyní potvrdil také nezávislý raw metadata GET. Původní expirovaný image grant zůstává zachovaný a jeho objekt nebyl při dřívější úspěšné inspekci přítomen; tento třetí objekt nebyl součástí nové čtecí kontroly.

## Historický návrh před schválením

Následující původní návrh byl schválen a proveden podle výsledku výše. Zmínky o budoucím souhlasu a neprovedené IAM změně popisují tehdejší přípravu. Původní `owned-media-metadata.json` s HTTP 403 a chybějícím `storage.objects.get` je zachovaný; stejné neúspěšné přístupy se neopakovaly.

Oprávněný správce může dodat čerstvý read-only výpis metadat právě těchto dvou objektů, nebo zvlášť schválit dočasné čtecí oprávnění pro stávající ověřený CLI účet. Totožnost je v chráněném původním `approval.json`; žádný nový principal, klíč ani service-account impersonation.

Případný samostatně schválený IAM postup má použít existující bucket, policy version 3 a podmínku omezenou na `resource.type == 'storage.googleapis.com/Object'` a přesný `resource.name` jednoho z uvedených dvou objektů. Nejvýše 30 minut od provedení; bez wildcardů a bez obecného přístupu k bucketu. Návrh role `roles/storage.objectViewer` obsahuje také list, ale podmínka pouze pro dva object resources nepovoluje bucket-level list. Role dovoluje i čtení bajtů těchto dvou syntetických souborů, nejen metadat. Žádné write/delete/update. Ostatní bindings se musí zachovat přes čerstvé etag; cizí drift znamená nové posouzení, nikoli přepsání policy. Expirovaná podmínka může zůstat v policy; její odstranění je samostatná pozdější změna.

Bucket již měl zapnuté uniform bucket-level access a public access prevention; žádné přepínání těchto ochran není navržené. Lead pouze dvěma GET přečetl aktuální policy v3 a `testPermissions`: stávající ověřený operátor má `storage.buckets.getIamPolicy` a `storage.buckets.setIamPolicy`. Připravený policy diff zachovává etag a všechny existující bindings, přidává pouze výše uvedenou podmíněnou roli pro tentýž účet. Chráněný `metadata-access-proposal-private.json` obsahuje přesný principal/policy; veřejný souhrn `metadata-access-proposal.json` jeho sémantický JSON hash (kompaktní serializace, nikoli hash bajtů odsazeného souboru) `d0583e45eeecc3db2319265d9250a4331905cc9a1eb7e338ac9aeb24597a0fb1`. Oba jsou v privátním QA root, žádná IAM změna neproběhla. Šablona má záměrně neplatný expiry placeholder, takže není spustitelným payloadem. Po samostatném schválení rozsahu připnout aktuální UTC expiry nejvýše +30 minut a znovu ověřit etag/shodu bindings; drift zastaví operaci. Schválení předchozího Storage Rules-only deploymentu IAM změnu neobsahovalo.

Semantiku rolí a podmínek dokládají [Cloud Storage IAM](https://docs.cloud.google.com/storage/docs/access-control/iam#conditions) a [Storage role definitions](https://docs.cloud.google.com/storage/docs/access-control/iam-roles). Přístup je aditivní; tento návrh netvrdí, že mění jiná existující oprávnění účtu.

Provedení používá [GET policy v3](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/getIamPolicy) a jediný [setIamPolicy PUT](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/setIamPolicy) s původním etag a zachováním ostatních bindings. Následuje [object metadata GET](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get) s přesnou `generation`, `projection=noAcl` a field mask; `alt=media` ani list se nepoužijí. Tyto API tvary byly před přípravou ověřeny v aktuální primární dokumentaci.

IAM `resource.name` omezuje cestu, nikoli generaci. Po zpřístupnění připnout každý GET na zachycenou generation, přečíst jen `name,bucket,generation,size,contentType,metadata`, porovnat název, bucket, generaci, velikost a MIME a uložit pouze metadata keys plus `downloadTokensPresent`; žádné token values do logů nebo Gitu. Nesoulad znamená zastavení bez automatického přechodu na jinou generaci. Úspěch znamená skutečně potvrzenou absenci download tokenů na těchto objektech, nikoli automatickou produkční či provozní akceptaci.
