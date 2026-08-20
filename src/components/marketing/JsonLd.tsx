const SITE_URL = "https://smashboard.triadsolutions.se";
const ORG_URL = "https://triadsolutions.se";

const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${ORG_URL}#organization`,
  name: "Triad Solutions",
  alternateName: "Triad",
  url: ORG_URL,
  logo: `${SITE_URL}/icons/logo.svg`,
  email: "kontakt@triadsolutions.se",
  description:
    "Triad Solutions bygger Smashboard — ett white-label turneringssystem för padelhallar.",
  sameAs: [ORG_URL, SITE_URL],
  contactPoint: [
    {
      "@type": "ContactPoint",
      email: "kontakt@triadsolutions.se",
      contactType: "sales",
      areaServed: "SE",
      availableLanguage: ["Swedish", "English"],
    },
  ],
};

const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Smashboard",
  url: SITE_URL,
  inLanguage: "sv-SE",
  publisher: { "@id": `${ORG_URL}#organization` },
};

const softwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Smashboard",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Sports tournament management software",
  operatingSystem: "Web",
  url: SITE_URL,
  description:
    "Smashboard är ett turneringssystem för padelhallar. Hosten skriver in resultat på laptopen och allt visas live på TV-skärmen. Stöd för Mexicano, Americano och Lag-Mexicano. White-label med egen subdomän.",
  inLanguage: "sv-SE",
  provider: {
    "@type": "Organization",
    name: "Triad Solutions",
    url: SITE_URL,
  },
  featureList: [
    "Live TV-display via HDMI",
    "Mexicano-format",
    "Americano-format",
    "Lag-Mexicano-format",
    "A/B/C-slutspel",
    "White-label per hall",
    "Egen subdomän",
    "Spelarregister",
    "Realtidssynk mellan host och display",
    "GDPR-kompatibel datalagring inom EU",
  ],
  offers: [
    {
      "@type": "Offer",
      name: "Start",
      price: "499",
      priceCurrency: "SEK",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "499",
        priceCurrency: "SEK",
        unitText: "MONTH",
      },
      description:
        "Mindre hallar med upp till 4 banor. Inkluderar Mexicano, Americano, Lag-Mexicano, TV-display och egen subdomän.",
      url: `${SITE_URL}#priser`,
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Hall",
      price: "999",
      priceCurrency: "SEK",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "999",
        priceCurrency: "SEK",
        unitText: "MONTH",
      },
      description:
        "Padelhallar med obegränsat antal banor, full white-label, alla format inklusive A/B/C-slutspel och prioriterad support.",
      url: `${SITE_URL}#priser`,
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Kedja",
      description:
        "Anpassat avtal för padelkedjor med flera anläggningar — konsoliderad statistik, SLA och dedikerad kontaktperson.",
      url: `${SITE_URL}#priser`,
      availability: "https://schema.org/InStock",
    },
  ],
  audience: {
    "@type": "BusinessAudience",
    audienceType: "Padelhallar och padelarrangörer",
    geographicArea: { "@type": "Country", name: "Sverige" },
  },
};

const faq = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Vad kostar Smashboard?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Smashboard kostar från 499 kr/månad för en mindre hall och 999 kr/månad för en hall med obegränsat antal banor. För padelkedjor med flera anläggningar tar vi fram ett anpassat avtal. Alla priser är exklusive moms och utan bindningstid.",
      },
    },
    {
      "@type": "Question",
      name: "Är det någon startavgift eller installationskostnad?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Nej. Onboarding, white-label-uppsättning (logga, färg, subdomän) och första turneringen ingår i månadspriset.",
      },
    },
    {
      "@type": "Question",
      name: "Hur många banor kan Smashboard hantera?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Smashboard skalar från 2 till 12+ banor i samma turnering. Display-vyn anpassar sig automatiskt så att alla banor får plats på TV:n utan att texten blir oläslig.",
      },
    },
    {
      "@type": "Question",
      name: "Vilken hårdvara behövs för att köra Smashboard?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "En vanlig laptop med modern webbläsare och en TV med HDMI-ingång. Inga särskilda installationer, inga drivrutiner, ingen app att ladda ner.",
      },
    },
    {
      "@type": "Question",
      name: "Var lagras spelardata?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "All data ligger inom EU (Supabase, Frankfurt). Smashboard är GDPR-kompatibel — hallen äger spelardata och kan exportera eller radera när som helst.",
      },
    },
    {
      "@type": "Question",
      name: "Är det någon bindningstid?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Nej. Du kan säga upp Smashboard när som helst utan bindningstid eller uppsägningstid.",
      },
    },
    {
      "@type": "Question",
      name: "Kan padelhallen använda sin egen logga och färg?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Ja. White-label är inkluderat från start. Hallen får en egen subdomän, laddar upp sin logga och väljer accentfärg. Smashboards varumärke syns aldrig på storskärmen.",
      },
    },
    {
      "@type": "Question",
      name: "Vilka turneringsformat stöds?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Smashboard stöder Mexicano (dynamiska par per rond), Americano (full round-robin på individnivå) och Lag-Mexicano (fasta par där banorna roterar efter prestation). Alla format kan kombineras med A/B/C-slutspel.",
      },
    },
  ],
};

export function JsonLd() {
  const blocks = [organization, website, softwareApplication, faq];
  return (
    <>
      {blocks.map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}
    </>
  );
}
