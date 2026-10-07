// Root domain that venue subdomains live under (bonpadel.mcasolutions.se).
export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "mcasolutions.se";

// Former root domain (Triad Solutions → MCA Solutions AB, 2026). Venue hosts
// under it still resolve; middleware 308s page requests to APP_DOMAIN.
export const LEGACY_APP_DOMAINS: readonly string[] = ["triadsolutions.se"].filter(
  (d) => d !== APP_DOMAIN,
);
