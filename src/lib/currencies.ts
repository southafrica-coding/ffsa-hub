export const BASE_CURRENCY = "ZAR";

/**
 * Every currency in use today (ISO 4217, from the Intl data, minus
 * precious metals, fund codes and retired currencies), so an outreach
 * team never lands somewhere the Hub can't record. ZAR first, then by
 * name. Outreach finance and school fees use this; ticketing has its own
 * short list below.
 */
export const SUPPORTED_CURRENCIES = [
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "AFN", name: "Afghan Afghani", symbol: "؋" },
  { code: "ALL", name: "Albanian Lek", symbol: "ALL" },
  { code: "DZD", name: "Algerian Dinar", symbol: "DZD" },
  { code: "AOA", name: "Angolan Kwanza", symbol: "Kz" },
  { code: "ARS", name: "Argentine Peso", symbol: "ARS" },
  { code: "AMD", name: "Armenian Dram", symbol: "֏" },
  { code: "AWG", name: "Aruban Florin", symbol: "AWG" },
  { code: "AUD", name: "Australian Dollar", symbol: "AUD" },
  { code: "AZN", name: "Azerbaijani Manat", symbol: "₼" },
  { code: "BSD", name: "Bahamian Dollar", symbol: "BSD" },
  { code: "BHD", name: "Bahraini Dinar", symbol: "BHD" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳" },
  { code: "BBD", name: "Barbadian Dollar", symbol: "BBD" },
  { code: "BYN", name: "Belarusian Ruble", symbol: "BYN" },
  { code: "BZD", name: "Belize Dollar", symbol: "BZD" },
  { code: "BMD", name: "Bermudan Dollar", symbol: "BMD" },
  { code: "BTN", name: "Bhutanese Ngultrum", symbol: "BTN" },
  { code: "BOB", name: "Bolivian Boliviano", symbol: "Bs" },
  { code: "BAM", name: "Bosnia-Herzegovina Convertible Mark", symbol: "KM" },
  { code: "BWP", name: "Botswana Pula", symbol: "P" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "BND", name: "Brunei Dollar", symbol: "BND" },
  { code: "BGN", name: "Bulgarian Lev", symbol: "BGN" },
  { code: "BIF", name: "Burundian Franc", symbol: "FBu" },
  { code: "XPF", name: "CFP Franc", symbol: "CFPF" },
  { code: "KHR", name: "Cambodian Riel", symbol: "៛" },
  { code: "CAD", name: "Canadian Dollar", symbol: "CAD" },
  { code: "CVE", name: "Cape Verdean Escudo", symbol: "CVE" },
  { code: "XCG", name: "Caribbean Guilder", symbol: "Cg." },
  { code: "KYD", name: "Cayman Islands Dollar", symbol: "KYD" },
  { code: "XAF", name: "Central African CFA Franc", symbol: "FCFA" },
  { code: "CLP", name: "Chilean Peso", symbol: "CLP" },
  { code: "CNY", name: "Chinese Yuan", symbol: "CNY" },
  { code: "COP", name: "Colombian Peso", symbol: "COP" },
  { code: "KMF", name: "Comorian Franc", symbol: "CF" },
  { code: "CDF", name: "Congolese Franc", symbol: "CDF" },
  { code: "CRC", name: "Costa Rican Colón", symbol: "₡" },
  { code: "CUP", name: "Cuban Peso", symbol: "CUP" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
  { code: "DKK", name: "Danish Krone", symbol: "DKK" },
  { code: "DJF", name: "Djiboutian Franc", symbol: "DJF" },
  { code: "DOP", name: "Dominican Peso", symbol: "DOP" },
  { code: "XCD", name: "East Caribbean Dollar", symbol: "XCD" },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£" },
  { code: "ERN", name: "Eritrean Nakfa", symbol: "ERN" },
  { code: "SZL", name: "Eswatini Lilangeni", symbol: "SZL" },
  { code: "ETB", name: "Ethiopian Birr", symbol: "ETB" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "FKP", name: "Falkland Islands Pound", symbol: "FKP" },
  { code: "FJD", name: "Fijian Dollar", symbol: "FJD" },
  { code: "GMD", name: "Gambian Dalasi", symbol: "GMD" },
  { code: "GEL", name: "Georgian Lari", symbol: "₾" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "GH₵" },
  { code: "GIP", name: "Gibraltar Pound", symbol: "GIP" },
  { code: "GTQ", name: "Guatemalan Quetzal", symbol: "Q" },
  { code: "GNF", name: "Guinean Franc", symbol: "FG" },
  { code: "GYD", name: "Guyanese Dollar", symbol: "GYD" },
  { code: "HTG", name: "Haitian Gourde", symbol: "HTG" },
  { code: "HNL", name: "Honduran Lempira", symbol: "HNL" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HKD" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft" },
  { code: "ISK", name: "Icelandic Króna", symbol: "ISK" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp" },
  { code: "IRR", name: "Iranian Rial", symbol: "IRR" },
  { code: "IQD", name: "Iraqi Dinar", symbol: "IQD" },
  { code: "ILS", name: "Israeli New Shekel", symbol: "₪" },
  { code: "JMD", name: "Jamaican Dollar", symbol: "JMD" },
  { code: "JPY", name: "Japanese Yen", symbol: "JPY" },
  { code: "JOD", name: "Jordanian Dinar", symbol: "JOD" },
  { code: "KZT", name: "Kazakhstani Tenge", symbol: "₸" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "KWD" },
  { code: "KGS", name: "Kyrgyz Som", symbol: "⃀" },
  { code: "LAK", name: "Laotian Kip", symbol: "₭" },
  { code: "LBP", name: "Lebanese Pound", symbol: "L£" },
  { code: "LSL", name: "Lesotho Loti", symbol: "LSL" },
  { code: "LRD", name: "Liberian Dollar", symbol: "LRD" },
  { code: "LYD", name: "Libyan Dinar", symbol: "LYD" },
  { code: "MOP", name: "Macanese Pataca", symbol: "MOP" },
  { code: "MKD", name: "Macedonian Denar", symbol: "MKD" },
  { code: "MGA", name: "Malagasy Ariary", symbol: "Ar" },
  { code: "MWK", name: "Malawian Kwacha", symbol: "MK" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "MVR", name: "Maldivian Rufiyaa", symbol: "MVR" },
  { code: "MRU", name: "Mauritanian Ouguiya", symbol: "MRU" },
  { code: "MUR", name: "Mauritian Rupee", symbol: "MUR" },
  { code: "MXN", name: "Mexican Peso", symbol: "MXN" },
  { code: "MDL", name: "Moldovan Leu", symbol: "MDL" },
  { code: "MNT", name: "Mongolian Tugrik", symbol: "₮" },
  { code: "MAD", name: "Moroccan Dirham", symbol: "MAD" },
  { code: "MZN", name: "Mozambican Metical", symbol: "MT" },
  { code: "MMK", name: "Myanmar Kyat", symbol: "K" },
  { code: "NAD", name: "Namibian Dollar", symbol: "N$" },
  { code: "NPR", name: "Nepalese Rupee", symbol: "NPR" },
  { code: "ANG", name: "Netherlands Antillean Guilder", symbol: "ANG" },
  { code: "TWD", name: "New Taiwan Dollar", symbol: "TWD" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZD" },
  { code: "NIO", name: "Nicaraguan Córdoba", symbol: "C$" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "KPW", name: "North Korean Won", symbol: "KPW" },
  { code: "NOK", name: "Norwegian Krone", symbol: "NOK" },
  { code: "OMR", name: "Omani Rial", symbol: "OMR" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "PKR" },
  { code: "PAB", name: "Panamanian Balboa", symbol: "PAB" },
  { code: "PGK", name: "Papua New Guinean Kina", symbol: "PGK" },
  { code: "PYG", name: "Paraguayan Guarani", symbol: "₲" },
  { code: "PEN", name: "Peruvian Sol", symbol: "PEN" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { code: "QAR", name: "Qatari Riyal", symbol: "QAR" },
  { code: "RON", name: "Romanian Leu", symbol: "lei" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽" },
  { code: "RWF", name: "Rwandan Franc", symbol: "RF" },
  { code: "SVC", name: "Salvadoran Colón", symbol: "SVC" },
  { code: "WST", name: "Samoan Tala", symbol: "WST" },
  { code: "SAR", name: "Saudi Riyal", symbol: "SAR" },
  { code: "RSD", name: "Serbian Dinar", symbol: "RSD" },
  { code: "SCR", name: "Seychellois Rupee", symbol: "SCR" },
  { code: "SLE", name: "Sierra Leonean Leone", symbol: "SLE" },
  { code: "SGD", name: "Singapore Dollar", symbol: "SGD" },
  { code: "SBD", name: "Solomon Islands Dollar", symbol: "SBD" },
  { code: "SOS", name: "Somali Shilling", symbol: "SOS" },
  { code: "KRW", name: "South Korean Won", symbol: "KRW" },
  { code: "SSP", name: "South Sudanese Pound", symbol: "SSP" },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "LKR" },
  { code: "SHP", name: "St. Helena Pound", symbol: "SHP" },
  { code: "SDG", name: "Sudanese Pound", symbol: "SDG" },
  { code: "SRD", name: "Surinamese Dollar", symbol: "SRD" },
  { code: "SEK", name: "Swedish Krona", symbol: "SEK" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "SYP", name: "Syrian Pound", symbol: "SYP" },
  { code: "STN", name: "São Tomé & Príncipe Dobra", symbol: "Db" },
  { code: "TJS", name: "Tajikistani Somoni", symbol: "TJS" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "TOP", name: "Tongan Paʻanga", symbol: "T$" },
  { code: "TTD", name: "Trinidad & Tobago Dollar", symbol: "TTD" },
  { code: "TND", name: "Tunisian Dinar", symbol: "TND" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺" },
  { code: "TMT", name: "Turkmenistani Manat", symbol: "TMT" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴" },
  { code: "AED", name: "United Arab Emirates Dirham", symbol: "AED" },
  { code: "UYU", name: "Uruguayan Peso", symbol: "UYU" },
  { code: "UZS", name: "Uzbekistani Som", symbol: "UZS" },
  { code: "VUV", name: "Vanuatu Vatu", symbol: "VUV" },
  { code: "VES", name: "Venezuelan Bolívar", symbol: "VES" },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫" },
  { code: "XOF", name: "West African CFA Franc", symbol: "F CFA" },
  { code: "YER", name: "Yemeni Rial", symbol: "YER" },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK" },
  { code: "ZWG", name: "Zimbabwean Gold", symbol: "ZWG" },
] as const;

/** Where outreach teams usually go — listed first where a picker has to be short (Slack caps menus at 100). */
export const COMMON_OUTREACH_CURRENCIES = [
  "ZAR", "BWP", "BIF", "KES", "LSL", "MGA", "MWK", "MZN", "NAD", "SZL", "TZS", "UGX", "ZMW",
  "USD", "EUR", "GBP", "KHR", "PYG", "THB",
];

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

// ────────────────────────────────────────────────────────────
// Event ticketing currencies
// ────────────────────────────────────────────────────────────
// A deliberately smaller list than SUPPORTED_CURRENCIES above (which
// serves outreach finance and school fees). Ticketing stores money as
// integer minor units — "cents" — everywhere, so it can only offer
// two-decimal currencies. Several entries above (BIF, PYG, UGX) are
// zero-decimal at Stripe and would be charged 100x wrong.
//
// Adding a currency here also needs a payment_fee_profiles row for it
// (see migration 134) or gross-up pricing has no rates to work from.

export const EVENT_CURRENCIES = [
  { code: "ZAR", name: "South African Rand", symbol: "R", locale: "en-ZA" },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US" },
] as const;

export type EventCurrencyCode = (typeof EVENT_CURRENCIES)[number]["code"];

export const DEFAULT_EVENT_CURRENCY: EventCurrencyCode = "ZAR";

export function isEventCurrency(value: unknown): value is EventCurrencyCode {
  return EVENT_CURRENCIES.some((c) => c.code === value);
}

/** The currency entry for a code, falling back to ZAR for anything unknown. */
export function eventCurrency(code: string | null | undefined) {
  return (
    EVENT_CURRENCIES.find((c) => c.code === code) ?? EVENT_CURRENCIES[0]
  );
}

/** Just the symbol — for inline hints like "Target net (R)". */
export function currencySymbol(code: string | null | undefined): string {
  return eventCurrency(code).symbol;
}

/**
 * Render integer minor units as money in `currency`.
 *
 * Replaces the hand-rolled `R${cents / 100}` helpers that used to live
 * privately in each storefront, the admin orders tab, the ticket
 * emails and the Slack report. Digits follow the currency's own locale
 * and the symbol is prefixed tight against them, matching how the
 * brand storefronts already rendered rands: ZAR reads "R1 234,56" and
 * USD reads "$1,234.56".
 *
 * Note this is NOT Intl's `style: "currency"`, which would insert a
 * space after the symbol ("R 1 234,56") and change every existing
 * price on the site.
 */
export function formatMoney(
  cents: number,
  currency: string | null | undefined = DEFAULT_EVENT_CURRENCY
): string {
  const entry = eventCurrency(currency);
  const amount = cents / 100;
  const digits = new Intl.NumberFormat(entry.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${entry.symbol}${digits}`;
}

/**
 * Which payment providers can take money in a currency.
 *
 * PayFast is a South African ZAR-only processor — its API has no
 * currency field at all — so anything other than ZAR is Stripe-only.
 * The checkout route enforces this; the storefronts use it to decide
 * which pay buttons to render.
 */
export function providersForCurrency(
  currency: string | null | undefined
): ReadonlyArray<"payfast" | "stripe"> {
  return eventCurrency(currency).code === "ZAR"
    ? (["payfast", "stripe"] as const)
    : (["stripe"] as const);
}
