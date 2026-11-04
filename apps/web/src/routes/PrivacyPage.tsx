/** Draft for local owner review; operator details must be approved before release. */
export function PrivacyPage() {
  return <article className="panel stack" aria-labelledby="privacy-title">
    <h1 id="privacy-title">Ochrana osobních údajů</h1>
    <p role="status"><strong>Návrh k doplnění před veřejným spuštěním.</strong> Provozovatel, kontakt, právní důvody a doby uchování čekají na potvrzení. Tento text zatím není úplnou informací o zpracování.</p>
    <h2>Registrace týmu</h2>
    <p>Formulář požaduje název týmu, počet členů a kontaktní e-mail. Aplikace je používá pro evidenci účasti, kapacitu, správu přihlášky a registrační komunikaci, pokud je odesílání zapnuté. Pro přihlášení týmu není potřeba účet.</p>
    <p>Kontaktní e-mail není veřejný. Vidí jej oprávnění pořadatelé. Název týmu a jeho výsledky mohou být zveřejněny při vyhlášení. Do názvu proto nevkládejte soukromé údaje.</p>
    <p>Soukromý odkaz umožňuje zobrazit, upravit nebo zrušit konkrétní přihlášku. Uchovávejte jej jako přístupový údaj. Zrušení uvolní místo, ale samo nevymaže uložený záznam. Ani konec akce automaticky nemaže kontakty.</p>
    <p>Ochrana opakovaných přihlášek používá neveřejný otisk e-mailu pro danou akci. Jde o pseudonymní údaj, nikoliv anonymizaci. Nejde o ověření vlastnictví adresy.</p>
    <h2>Účty obsluhy</h2>
    <p>Přihlášení obsluhy používá Firebase Authentication. Aplikace pracuje s e-mailem, zobrazovaným jménem, identifikátorem účtu, členstvím, oprávněními a bezpečnostními záznamy operací. Heslo při přihlášení a obnově zpracovává Firebase Authentication. Přístup k údajům závisí na aktuálním oprávnění pro konkrétní akci.</p>
    <h2>Poskytovatelé a uložení</h2>
    <p>Firebase a Google Cloud zajišťují přihlášení, serverové zpracování a uložení. Při zapnutém odesílání se registrační zprávy předávají poskytovateli e-mailu. Volitelné propojení Google Drive a Gmailu se týká obsluhy; účastník svůj Google účet nepřipojuje.</p>
    <p>Požadavky mohou zahrnovat také provozní údaje, například IP adresu a čas. Přesný rozsah služeb, umístění, příjemce, případná předání mimo EHP a související záruky musí provozovatel potvrdit podle skutečného nastavení.</p>
    <h2>Co ještě doplnit</h2>
    <dl>
      <dt>Správce a kontakt pro žádosti</dt><dd>ČEKÁ NA DOPLNĚNÍ VLASTNÍKEM.</dd>
      <dt>Právní důvody a doba uchování</dt><dd>ČEKÁ NA POTVRZENÍ pro registrace, výsledky, účty obsluhy, provozní záznamy a zálohy. Tato verze aplikace automatický výmaz registrací nezajišťuje.</dd>
      <dt>Žádost o opravu nebo výmaz</dt><dd>Před spuštěním zde bude schválený kontakt a postup ověření žadatele. Do žádosti neposílejte heslo ani soukromý odkaz pro správu registrace.</dd>
    </dl>
    <h2>Vaše práva</h2>
    <p>Podle podmínek platných předpisů můžete požádat o přístup, opravu, výmaz, omezení zpracování či přenositelnost a vznést námitku. Je-li zpracování založeno na souhlasu, lze jej odvolat. Můžete podat stížnost u <a href="https://uoou.gov.cz/" rel="noreferrer">Úřadu pro ochranu osobních údajů</a>.</p>
    <p>Údaje označené jako povinné jsou potřeba pro zpracování přihlášky; bez nich ji formulář neodešle.</p>
  </article>;
}
