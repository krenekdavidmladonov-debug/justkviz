export function PrivacyPage() {
  const name = import.meta.env.VITE_PRIVACY_CONTROLLER_NAME;
  const ico = import.meta.env.VITE_PRIVACY_CONTROLLER_ICO;
  const seat = import.meta.env.VITE_PRIVACY_CONTROLLER_SEAT;
  const email = import.meta.env.VITE_PRIVACY_CONTROLLER_EMAIL;
  if (!name || !ico || !seat || !email) {
    return <article className="panel stack privacy-page" aria-labelledby="privacy-title">
      <h1 id="privacy-title">Ochrana osobních údajů</h1>
      <p>Informace se v tomto sestavení nepodařilo načíst.</p>
    </article>;
  }
  return <article className="panel stack privacy-page" aria-labelledby="privacy-title">
    <h1 id="privacy-title">Ochrana osobních údajů</h1>
    <p>JustKvíz provozuje a osobní údaje spravuje {name}, IČO {ico}, se sídlem {seat}, zapsaný v živnostenském rejstříku. Pro dotazy a žádosti pište na <a href={`mailto:${email}`}>{email}</a>.</p>

    <h2>Registrace a výsledky</h2>
    <p>Pro online přihlášení potřebujeme název týmu, počet členů a kontaktní e-mail. Tyto údaje používáme k rezervaci místa, správě přihlášky a komunikaci o akci. Právním základem je zajištění účasti a kroky před uzavřením smlouvy na vaši žádost podle čl. 6 odst. 1 písm. b) GDPR. Bez těchto údajů nelze online přihlášku odeslat. Pokud e-mail poskytl jiný člen týmu nebo ho zadala obsluha při ruční registraci, oprávněným zájmem podle písm. f) je vyřídit přihlášku a předat týmu informace o akci.</p>
    <p>Ke kontaktům mají přístup oprávněné osoby zajišťující akci. Název týmu, body a pořadí se mohou zobrazit při vyhlášení. Oprávněným zájmem je sdělit účastníkům výsledky a doložit pořadí. Do názvu týmu proto nevkládejte soukromé údaje. Soukromým odkazem lze přihlášku upravit nebo zrušit. Zrušení uvolní místo a záznam přihlášky zůstane evidovaný.</p>

    <h2>Účty a bezpečnost</h2>
    <p>Pro vytvoření a správu účtu používáme e-mail, zobrazované jméno a identifikátor účtu podle čl. 6 odst. 1 písm. b) GDPR. Přihlášení, ověření e-mailu a obnovu hesla zajišťuje Firebase Authentication. U obsluhy evidujeme také pozvánky, oprávnění a bezpečnostní záznamy. K ochraně přístupu a omezení zneužití používáme provozní údaje a neveřejný otisk e-mailu pro konkrétní akci. Ochrana služby a obnovitelnost dat jsou naším oprávněným zájmem podle písm. f).</p>
    <p>Aplikace kontroluje kapacitu a omezuje opakované pokusy. Pokud formulář přihlášku odmítne a domníváte se, že jde o chybu, napište správci a požádejte o prověření.</p>

    <h2>Uchování údajů</h2>
    <ul>
      <li><strong>Kontakty týmů a související e-mailové podklady</strong> mají lhůtu 90 dní po skončení akce. U zrušené akce se lhůta počítá ode dne jejího zrušení.</li>
      <li><strong>Identifikovatelné výsledky</strong> mají lhůtu 12 měsíců po skončení akce. Po uplynutí lhůty jsou určeny k výmazu nebo anonymizaci, po níž už osoby nelze určit.</li>
      <li><strong>Běžné aplikační a technické logy</strong> se v Cloud Logging uchovávají 30 dní od vzniku. Vybrané povinné systémové a auditní záznamy Google Cloud mají pevnou lhůtu 400 dní. Potřebné záznamy o bezpečnostním incidentu lze uchovat do uzavření šetření a splnění souvisejících povinností.</li>
      <li><strong>Účetní a další zákonem vyžadované doklady</strong> se uchovávají po dobu stanovenou příslušnými předpisy.</li>
    </ul>
    <p>Lhůty u kontaktů a výsledků se kontrolují ručně. Aplikace po jejich uplynutí sama výmaz ani anonymizaci neprovede. Údaje účtu jsou potřebné po dobu jeho používání a údaje pozvánek do vyřízení přístupu.</p>
    <p>Pro denní zálohy databáze je nastaveno uchování 7 dní a pro týdenní 28 dní. Historie pro obnovu databáze je nastavena až na 7 dní. Záznamy ve schránkách příjemců a kopie na zařízeních mají vlastní dobu uchování.</p>

    <h2>Příjemci a předávání údajů</h2>
    <p>Web, přihlášení, server a úložiště zajišťují Firebase a Google Cloud. Pokud pořadatel používá propojení s Gmailem, Google dostává adresu příjemce a obsah odesílané zprávy. Propojení Google Disku slouží obsluze k práci s médii.</p>
    <p>Firebase Authentication zpracovává údaje v USA. Pro předání subjektům zapojeným do rámce EU–USA se použije rozhodnutí Evropské komise o odpovídající ochraně. Podmínky Googlu pro Firebase a Google Cloud stanoví pro další omezená předání podle okolností standardní smluvní doložky. Informace o konkrétním předání a kopii použitých záruk lze vyžádat u správce.</p>
    <p><a href="https://firebase.google.com/support/privacy" rel="noreferrer">Soukromí ve Firebase</a> · <a href="https://cloud.google.com/terms/data-processing-addendum" rel="noreferrer">Podmínky Google Cloud</a> · <a href="https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/eu-us-data-transfers_en" rel="noreferrer">Předávání mezi EU a USA</a></p>

    <h2>Prohlížeč a externí média</h2>
    <p>Prohlížeč může uložit stav přihlášení a některých úloh. Pokud obsluha použije offline režim, její zařízení uloží aplikaci a data potřebná k odehrání kvízu. Při zobrazení externího obrázku nebo načtení vloženého přehrávače YouTube se prohlížeč připojí ke službě, která médium poskytuje. Informace o těchto službách uvádějí jejich poskytovatelé. <a href="https://policies.google.com/privacy" rel="noreferrer">Zásady ochrany soukromí Google</a></p>

    <h2>Vaše práva</h2>
    <p>U správce můžete požádat o přístup k údajům, jejich opravu, výmaz nebo omezení zpracování a za podmínek GDPR o přenositelnost. Proti zpracování na základě oprávněného zájmu můžete vznést námitku. Do žádosti neposílejte heslo ani soukromý odkaz k přihlášce. Stížnost můžete podat u <a href="https://uoou.gov.cz/kontakt/podatelna-a-elektronicka-podatelna" rel="noreferrer">Úřadu pro ochranu osobních údajů</a>.</p>
  </article>;
}
