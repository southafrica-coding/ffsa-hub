// ────────────────────────────────────────────────────────────
// PROFILE DROPDOWN OPTIONS — single source of truth
// ────────────────────────────────────────────────────────────
// Used by:
//   - Onboarding flow (src/app/(auth)/onboarding/page.tsx)
//   - ProfileCompletionGate form (src/components/profile-completion-form.tsx)
//
// Adjusting a list here updates both surfaces. Keep entries
// alphabetical (countries / providers) so the dropdowns scan
// quickly. SA-relevant items appear in their natural alpha
// position; we don't promote them to the top.

export type Option = { value: string; label: string };

export type Country = {
  iso: string;       // ISO 3166-1 alpha-2
  name: string;      // English short name (what we store + show)
  dial: string;      // E.164 dial code, with leading +
  flag: string;      // Emoji flag
  nationality: string; // Adjective form ("South African")
};

// ────────────────────────────────────────────────────────────
// Countries. Comprehensive but not exhaustive (~140 most
// commonly-needed). Add more here as real users surface them —
// editing this list is the only thing needed.
// ────────────────────────────────────────────────────────────
export const COUNTRIES: Country[] = [
  { iso: "AF", name: "Afghanistan", dial: "+93", flag: "🇦🇫", nationality: "Afghan" },
  { iso: "AL", name: "Albania", dial: "+355", flag: "🇦🇱", nationality: "Albanian" },
  { iso: "DZ", name: "Algeria", dial: "+213", flag: "🇩🇿", nationality: "Algerian" },
  { iso: "AO", name: "Angola", dial: "+244", flag: "🇦🇴", nationality: "Angolan" },
  { iso: "AR", name: "Argentina", dial: "+54", flag: "🇦🇷", nationality: "Argentine" },
  { iso: "AM", name: "Armenia", dial: "+374", flag: "🇦🇲", nationality: "Armenian" },
  { iso: "AU", name: "Australia", dial: "+61", flag: "🇦🇺", nationality: "Australian" },
  { iso: "AT", name: "Austria", dial: "+43", flag: "🇦🇹", nationality: "Austrian" },
  { iso: "AZ", name: "Azerbaijan", dial: "+994", flag: "🇦🇿", nationality: "Azerbaijani" },
  { iso: "BS", name: "Bahamas", dial: "+1242", flag: "🇧🇸", nationality: "Bahamian" },
  { iso: "BH", name: "Bahrain", dial: "+973", flag: "🇧🇭", nationality: "Bahraini" },
  { iso: "BD", name: "Bangladesh", dial: "+880", flag: "🇧🇩", nationality: "Bangladeshi" },
  { iso: "BB", name: "Barbados", dial: "+1246", flag: "🇧🇧", nationality: "Barbadian" },
  { iso: "BY", name: "Belarus", dial: "+375", flag: "🇧🇾", nationality: "Belarusian" },
  { iso: "BE", name: "Belgium", dial: "+32", flag: "🇧🇪", nationality: "Belgian" },
  { iso: "BZ", name: "Belize", dial: "+501", flag: "🇧🇿", nationality: "Belizean" },
  { iso: "BJ", name: "Benin", dial: "+229", flag: "🇧🇯", nationality: "Beninese" },
  { iso: "BT", name: "Bhutan", dial: "+975", flag: "🇧🇹", nationality: "Bhutanese" },
  { iso: "BO", name: "Bolivia", dial: "+591", flag: "🇧🇴", nationality: "Bolivian" },
  { iso: "BA", name: "Bosnia and Herzegovina", dial: "+387", flag: "🇧🇦", nationality: "Bosnian" },
  { iso: "BW", name: "Botswana", dial: "+267", flag: "🇧🇼", nationality: "Motswana" },
  { iso: "BR", name: "Brazil", dial: "+55", flag: "🇧🇷", nationality: "Brazilian" },
  { iso: "BG", name: "Bulgaria", dial: "+359", flag: "🇧🇬", nationality: "Bulgarian" },
  { iso: "BF", name: "Burkina Faso", dial: "+226", flag: "🇧🇫", nationality: "Burkinabé" },
  { iso: "BI", name: "Burundi", dial: "+257", flag: "🇧🇮", nationality: "Burundian" },
  { iso: "KH", name: "Cambodia", dial: "+855", flag: "🇰🇭", nationality: "Cambodian" },
  { iso: "CM", name: "Cameroon", dial: "+237", flag: "🇨🇲", nationality: "Cameroonian" },
  { iso: "CA", name: "Canada", dial: "+1", flag: "🇨🇦", nationality: "Canadian" },
  { iso: "CV", name: "Cape Verde", dial: "+238", flag: "🇨🇻", nationality: "Cape Verdean" },
  { iso: "CF", name: "Central African Republic", dial: "+236", flag: "🇨🇫", nationality: "Central African" },
  { iso: "TD", name: "Chad", dial: "+235", flag: "🇹🇩", nationality: "Chadian" },
  { iso: "CL", name: "Chile", dial: "+56", flag: "🇨🇱", nationality: "Chilean" },
  { iso: "CN", name: "China", dial: "+86", flag: "🇨🇳", nationality: "Chinese" },
  { iso: "CO", name: "Colombia", dial: "+57", flag: "🇨🇴", nationality: "Colombian" },
  { iso: "KM", name: "Comoros", dial: "+269", flag: "🇰🇲", nationality: "Comoran" },
  { iso: "CG", name: "Congo (Brazzaville)", dial: "+242", flag: "🇨🇬", nationality: "Congolese" },
  { iso: "CD", name: "Congo (DRC)", dial: "+243", flag: "🇨🇩", nationality: "Congolese" },
  { iso: "CR", name: "Costa Rica", dial: "+506", flag: "🇨🇷", nationality: "Costa Rican" },
  { iso: "CI", name: "Côte d'Ivoire", dial: "+225", flag: "🇨🇮", nationality: "Ivorian" },
  { iso: "HR", name: "Croatia", dial: "+385", flag: "🇭🇷", nationality: "Croatian" },
  { iso: "CU", name: "Cuba", dial: "+53", flag: "🇨🇺", nationality: "Cuban" },
  { iso: "CY", name: "Cyprus", dial: "+357", flag: "🇨🇾", nationality: "Cypriot" },
  { iso: "CZ", name: "Czech Republic", dial: "+420", flag: "🇨🇿", nationality: "Czech" },
  { iso: "DK", name: "Denmark", dial: "+45", flag: "🇩🇰", nationality: "Danish" },
  { iso: "DJ", name: "Djibouti", dial: "+253", flag: "🇩🇯", nationality: "Djiboutian" },
  { iso: "DO", name: "Dominican Republic", dial: "+1809", flag: "🇩🇴", nationality: "Dominican" },
  { iso: "EC", name: "Ecuador", dial: "+593", flag: "🇪🇨", nationality: "Ecuadorian" },
  { iso: "EG", name: "Egypt", dial: "+20", flag: "🇪🇬", nationality: "Egyptian" },
  { iso: "SV", name: "El Salvador", dial: "+503", flag: "🇸🇻", nationality: "Salvadoran" },
  { iso: "GQ", name: "Equatorial Guinea", dial: "+240", flag: "🇬🇶", nationality: "Equatoguinean" },
  { iso: "ER", name: "Eritrea", dial: "+291", flag: "🇪🇷", nationality: "Eritrean" },
  { iso: "EE", name: "Estonia", dial: "+372", flag: "🇪🇪", nationality: "Estonian" },
  { iso: "SZ", name: "Eswatini", dial: "+268", flag: "🇸🇿", nationality: "Swazi" },
  { iso: "ET", name: "Ethiopia", dial: "+251", flag: "🇪🇹", nationality: "Ethiopian" },
  { iso: "FJ", name: "Fiji", dial: "+679", flag: "🇫🇯", nationality: "Fijian" },
  { iso: "FI", name: "Finland", dial: "+358", flag: "🇫🇮", nationality: "Finnish" },
  { iso: "FR", name: "France", dial: "+33", flag: "🇫🇷", nationality: "French" },
  { iso: "GA", name: "Gabon", dial: "+241", flag: "🇬🇦", nationality: "Gabonese" },
  { iso: "GM", name: "Gambia", dial: "+220", flag: "🇬🇲", nationality: "Gambian" },
  { iso: "GE", name: "Georgia", dial: "+995", flag: "🇬🇪", nationality: "Georgian" },
  { iso: "DE", name: "Germany", dial: "+49", flag: "🇩🇪", nationality: "German" },
  { iso: "GH", name: "Ghana", dial: "+233", flag: "🇬🇭", nationality: "Ghanaian" },
  { iso: "GR", name: "Greece", dial: "+30", flag: "🇬🇷", nationality: "Greek" },
  { iso: "GT", name: "Guatemala", dial: "+502", flag: "🇬🇹", nationality: "Guatemalan" },
  { iso: "GN", name: "Guinea", dial: "+224", flag: "🇬🇳", nationality: "Guinean" },
  { iso: "GW", name: "Guinea-Bissau", dial: "+245", flag: "🇬🇼", nationality: "Bissau-Guinean" },
  { iso: "GY", name: "Guyana", dial: "+592", flag: "🇬🇾", nationality: "Guyanese" },
  { iso: "HT", name: "Haiti", dial: "+509", flag: "🇭🇹", nationality: "Haitian" },
  { iso: "HN", name: "Honduras", dial: "+504", flag: "🇭🇳", nationality: "Honduran" },
  { iso: "HK", name: "Hong Kong", dial: "+852", flag: "🇭🇰", nationality: "Hong Konger" },
  { iso: "HU", name: "Hungary", dial: "+36", flag: "🇭🇺", nationality: "Hungarian" },
  { iso: "IS", name: "Iceland", dial: "+354", flag: "🇮🇸", nationality: "Icelandic" },
  { iso: "IN", name: "India", dial: "+91", flag: "🇮🇳", nationality: "Indian" },
  { iso: "ID", name: "Indonesia", dial: "+62", flag: "🇮🇩", nationality: "Indonesian" },
  { iso: "IR", name: "Iran", dial: "+98", flag: "🇮🇷", nationality: "Iranian" },
  { iso: "IQ", name: "Iraq", dial: "+964", flag: "🇮🇶", nationality: "Iraqi" },
  { iso: "IE", name: "Ireland", dial: "+353", flag: "🇮🇪", nationality: "Irish" },
  { iso: "IL", name: "Israel", dial: "+972", flag: "🇮🇱", nationality: "Israeli" },
  { iso: "IT", name: "Italy", dial: "+39", flag: "🇮🇹", nationality: "Italian" },
  { iso: "JM", name: "Jamaica", dial: "+1876", flag: "🇯🇲", nationality: "Jamaican" },
  { iso: "JP", name: "Japan", dial: "+81", flag: "🇯🇵", nationality: "Japanese" },
  { iso: "JO", name: "Jordan", dial: "+962", flag: "🇯🇴", nationality: "Jordanian" },
  { iso: "KZ", name: "Kazakhstan", dial: "+7", flag: "🇰🇿", nationality: "Kazakh" },
  { iso: "KE", name: "Kenya", dial: "+254", flag: "🇰🇪", nationality: "Kenyan" },
  { iso: "KW", name: "Kuwait", dial: "+965", flag: "🇰🇼", nationality: "Kuwaiti" },
  { iso: "KG", name: "Kyrgyzstan", dial: "+996", flag: "🇰🇬", nationality: "Kyrgyz" },
  { iso: "LA", name: "Laos", dial: "+856", flag: "🇱🇦", nationality: "Laotian" },
  { iso: "LV", name: "Latvia", dial: "+371", flag: "🇱🇻", nationality: "Latvian" },
  { iso: "LB", name: "Lebanon", dial: "+961", flag: "🇱🇧", nationality: "Lebanese" },
  { iso: "LS", name: "Lesotho", dial: "+266", flag: "🇱🇸", nationality: "Mosotho" },
  { iso: "LR", name: "Liberia", dial: "+231", flag: "🇱🇷", nationality: "Liberian" },
  { iso: "LY", name: "Libya", dial: "+218", flag: "🇱🇾", nationality: "Libyan" },
  { iso: "LT", name: "Lithuania", dial: "+370", flag: "🇱🇹", nationality: "Lithuanian" },
  { iso: "LU", name: "Luxembourg", dial: "+352", flag: "🇱🇺", nationality: "Luxembourgish" },
  { iso: "MO", name: "Macau", dial: "+853", flag: "🇲🇴", nationality: "Macanese" },
  { iso: "MG", name: "Madagascar", dial: "+261", flag: "🇲🇬", nationality: "Malagasy" },
  { iso: "MW", name: "Malawi", dial: "+265", flag: "🇲🇼", nationality: "Malawian" },
  { iso: "MY", name: "Malaysia", dial: "+60", flag: "🇲🇾", nationality: "Malaysian" },
  { iso: "MV", name: "Maldives", dial: "+960", flag: "🇲🇻", nationality: "Maldivian" },
  { iso: "ML", name: "Mali", dial: "+223", flag: "🇲🇱", nationality: "Malian" },
  { iso: "MT", name: "Malta", dial: "+356", flag: "🇲🇹", nationality: "Maltese" },
  { iso: "MR", name: "Mauritania", dial: "+222", flag: "🇲🇷", nationality: "Mauritanian" },
  { iso: "MU", name: "Mauritius", dial: "+230", flag: "🇲🇺", nationality: "Mauritian" },
  { iso: "MX", name: "Mexico", dial: "+52", flag: "🇲🇽", nationality: "Mexican" },
  { iso: "MD", name: "Moldova", dial: "+373", flag: "🇲🇩", nationality: "Moldovan" },
  { iso: "MN", name: "Mongolia", dial: "+976", flag: "🇲🇳", nationality: "Mongolian" },
  { iso: "ME", name: "Montenegro", dial: "+382", flag: "🇲🇪", nationality: "Montenegrin" },
  { iso: "MA", name: "Morocco", dial: "+212", flag: "🇲🇦", nationality: "Moroccan" },
  { iso: "MZ", name: "Mozambique", dial: "+258", flag: "🇲🇿", nationality: "Mozambican" },
  { iso: "MM", name: "Myanmar", dial: "+95", flag: "🇲🇲", nationality: "Burmese" },
  { iso: "NA", name: "Namibia", dial: "+264", flag: "🇳🇦", nationality: "Namibian" },
  { iso: "NP", name: "Nepal", dial: "+977", flag: "🇳🇵", nationality: "Nepali" },
  { iso: "NL", name: "Netherlands", dial: "+31", flag: "🇳🇱", nationality: "Dutch" },
  { iso: "NZ", name: "New Zealand", dial: "+64", flag: "🇳🇿", nationality: "New Zealander" },
  { iso: "NI", name: "Nicaragua", dial: "+505", flag: "🇳🇮", nationality: "Nicaraguan" },
  { iso: "NE", name: "Niger", dial: "+227", flag: "🇳🇪", nationality: "Nigerien" },
  { iso: "NG", name: "Nigeria", dial: "+234", flag: "🇳🇬", nationality: "Nigerian" },
  { iso: "KP", name: "North Korea", dial: "+850", flag: "🇰🇵", nationality: "North Korean" },
  { iso: "MK", name: "North Macedonia", dial: "+389", flag: "🇲🇰", nationality: "Macedonian" },
  { iso: "NO", name: "Norway", dial: "+47", flag: "🇳🇴", nationality: "Norwegian" },
  { iso: "OM", name: "Oman", dial: "+968", flag: "🇴🇲", nationality: "Omani" },
  { iso: "PK", name: "Pakistan", dial: "+92", flag: "🇵🇰", nationality: "Pakistani" },
  { iso: "PS", name: "Palestine", dial: "+970", flag: "🇵🇸", nationality: "Palestinian" },
  { iso: "PA", name: "Panama", dial: "+507", flag: "🇵🇦", nationality: "Panamanian" },
  { iso: "PG", name: "Papua New Guinea", dial: "+675", flag: "🇵🇬", nationality: "Papua New Guinean" },
  { iso: "PY", name: "Paraguay", dial: "+595", flag: "🇵🇾", nationality: "Paraguayan" },
  { iso: "PE", name: "Peru", dial: "+51", flag: "🇵🇪", nationality: "Peruvian" },
  { iso: "PH", name: "Philippines", dial: "+63", flag: "🇵🇭", nationality: "Filipino" },
  { iso: "PL", name: "Poland", dial: "+48", flag: "🇵🇱", nationality: "Polish" },
  { iso: "PT", name: "Portugal", dial: "+351", flag: "🇵🇹", nationality: "Portuguese" },
  { iso: "PR", name: "Puerto Rico", dial: "+1787", flag: "🇵🇷", nationality: "Puerto Rican" },
  { iso: "QA", name: "Qatar", dial: "+974", flag: "🇶🇦", nationality: "Qatari" },
  { iso: "RO", name: "Romania", dial: "+40", flag: "🇷🇴", nationality: "Romanian" },
  { iso: "RU", name: "Russia", dial: "+7", flag: "🇷🇺", nationality: "Russian" },
  { iso: "RW", name: "Rwanda", dial: "+250", flag: "🇷🇼", nationality: "Rwandan" },
  { iso: "SA", name: "Saudi Arabia", dial: "+966", flag: "🇸🇦", nationality: "Saudi" },
  { iso: "SN", name: "Senegal", dial: "+221", flag: "🇸🇳", nationality: "Senegalese" },
  { iso: "RS", name: "Serbia", dial: "+381", flag: "🇷🇸", nationality: "Serbian" },
  { iso: "SC", name: "Seychelles", dial: "+248", flag: "🇸🇨", nationality: "Seychellois" },
  { iso: "SL", name: "Sierra Leone", dial: "+232", flag: "🇸🇱", nationality: "Sierra Leonean" },
  { iso: "SG", name: "Singapore", dial: "+65", flag: "🇸🇬", nationality: "Singaporean" },
  { iso: "SK", name: "Slovakia", dial: "+421", flag: "🇸🇰", nationality: "Slovak" },
  { iso: "SI", name: "Slovenia", dial: "+386", flag: "🇸🇮", nationality: "Slovenian" },
  { iso: "SO", name: "Somalia", dial: "+252", flag: "🇸🇴", nationality: "Somali" },
  { iso: "ZA", name: "South Africa", dial: "+27", flag: "🇿🇦", nationality: "South African" },
  { iso: "KR", name: "South Korea", dial: "+82", flag: "🇰🇷", nationality: "South Korean" },
  { iso: "SS", name: "South Sudan", dial: "+211", flag: "🇸🇸", nationality: "South Sudanese" },
  { iso: "ES", name: "Spain", dial: "+34", flag: "🇪🇸", nationality: "Spanish" },
  { iso: "LK", name: "Sri Lanka", dial: "+94", flag: "🇱🇰", nationality: "Sri Lankan" },
  { iso: "SD", name: "Sudan", dial: "+249", flag: "🇸🇩", nationality: "Sudanese" },
  { iso: "SR", name: "Suriname", dial: "+597", flag: "🇸🇷", nationality: "Surinamese" },
  { iso: "SE", name: "Sweden", dial: "+46", flag: "🇸🇪", nationality: "Swedish" },
  { iso: "CH", name: "Switzerland", dial: "+41", flag: "🇨🇭", nationality: "Swiss" },
  { iso: "SY", name: "Syria", dial: "+963", flag: "🇸🇾", nationality: "Syrian" },
  { iso: "TW", name: "Taiwan", dial: "+886", flag: "🇹🇼", nationality: "Taiwanese" },
  { iso: "TJ", name: "Tajikistan", dial: "+992", flag: "🇹🇯", nationality: "Tajik" },
  { iso: "TZ", name: "Tanzania", dial: "+255", flag: "🇹🇿", nationality: "Tanzanian" },
  { iso: "TH", name: "Thailand", dial: "+66", flag: "🇹🇭", nationality: "Thai" },
  { iso: "TL", name: "Timor-Leste", dial: "+670", flag: "🇹🇱", nationality: "Timorese" },
  { iso: "TG", name: "Togo", dial: "+228", flag: "🇹🇬", nationality: "Togolese" },
  { iso: "TT", name: "Trinidad and Tobago", dial: "+1868", flag: "🇹🇹", nationality: "Trinidadian" },
  { iso: "TN", name: "Tunisia", dial: "+216", flag: "🇹🇳", nationality: "Tunisian" },
  { iso: "TR", name: "Turkey", dial: "+90", flag: "🇹🇷", nationality: "Turkish" },
  { iso: "TM", name: "Turkmenistan", dial: "+993", flag: "🇹🇲", nationality: "Turkmen" },
  { iso: "UG", name: "Uganda", dial: "+256", flag: "🇺🇬", nationality: "Ugandan" },
  { iso: "UA", name: "Ukraine", dial: "+380", flag: "🇺🇦", nationality: "Ukrainian" },
  { iso: "AE", name: "United Arab Emirates", dial: "+971", flag: "🇦🇪", nationality: "Emirati" },
  { iso: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧", nationality: "British" },
  { iso: "US", name: "United States", dial: "+1", flag: "🇺🇸", nationality: "American" },
  { iso: "UY", name: "Uruguay", dial: "+598", flag: "🇺🇾", nationality: "Uruguayan" },
  { iso: "UZ", name: "Uzbekistan", dial: "+998", flag: "🇺🇿", nationality: "Uzbek" },
  { iso: "VE", name: "Venezuela", dial: "+58", flag: "🇻🇪", nationality: "Venezuelan" },
  { iso: "VN", name: "Vietnam", dial: "+84", flag: "🇻🇳", nationality: "Vietnamese" },
  { iso: "YE", name: "Yemen", dial: "+967", flag: "🇾🇪", nationality: "Yemeni" },
  { iso: "ZM", name: "Zambia", dial: "+260", flag: "🇿🇲", nationality: "Zambian" },
  { iso: "ZW", name: "Zimbabwe", dial: "+263", flag: "🇿🇼", nationality: "Zimbabwean" },
];

export const COUNTRY_OPTIONS: Option[] = COUNTRIES.map((c) => ({
  value: c.name,
  label: `${c.flag} ${c.name}`,
}));

export const NATIONALITY_OPTIONS: Option[] = (() => {
  // De-dup nationality strings (Congolese / Congolese collide). Use a Set.
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const c of [...COUNTRIES].sort((a, b) =>
    a.nationality.localeCompare(b.nationality)
  )) {
    if (seen.has(c.nationality)) continue;
    seen.add(c.nationality);
    out.push({ value: c.nationality, label: c.nationality });
  }
  return out;
})();

// ────────────────────────────────────────────────────────────
// South African provinces. When country = South Africa we
// force a dropdown; otherwise the province field falls back
// to a free-text input.
// ────────────────────────────────────────────────────────────
export const SA_PROVINCES: Option[] = [
  { value: "Eastern Cape", label: "Eastern Cape" },
  { value: "Free State", label: "Free State" },
  { value: "Gauteng", label: "Gauteng" },
  { value: "KwaZulu-Natal", label: "KwaZulu-Natal" },
  { value: "Limpopo", label: "Limpopo" },
  { value: "Mpumalanga", label: "Mpumalanga" },
  { value: "Northern Cape", label: "Northern Cape" },
  { value: "North West", label: "North West" },
  { value: "Western Cape", label: "Western Cape" },
];

// ────────────────────────────────────────────────────────────
// Gender. Onboarding used to be free-text (people wrote
// anything). Lock to a short list.
// ────────────────────────────────────────────────────────────
export const GENDER_OPTIONS: Option[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

// ────────────────────────────────────────────────────────────
// Emergency-contact relationship.
// ────────────────────────────────────────────────────────────
export const RELATIONSHIP_OPTIONS: Option[] = [
  { value: "parent", label: "Parent" },
  { value: "spouse", label: "Spouse" },
  { value: "sibling", label: "Sibling" },
  { value: "child", label: "Child" },
  { value: "guardian", label: "Guardian" },
  { value: "friend", label: "Friend" },
  { value: "pastor", label: "Pastor / Spiritual leader" },
  { value: "other", label: "Other" },
];

// ────────────────────────────────────────────────────────────
// Health insurance providers — SA major schemes. Selecting
// "other" reveals a free-text input ("specify your provider").
// ────────────────────────────────────────────────────────────
export const INSURANCE_PROVIDERS: Option[] = [
  { value: "Discovery Health", label: "Discovery Health" },
  { value: "Bonitas", label: "Bonitas" },
  { value: "Momentum Health", label: "Momentum Health" },
  { value: "Medihelp", label: "Medihelp" },
  { value: "Fedhealth", label: "Fedhealth" },
  { value: "Bestmed", label: "Bestmed" },
  { value: "GEMS", label: "GEMS (Government Employees)" },
  { value: "Polmed", label: "Polmed (Police)" },
  { value: "Profmed", label: "Profmed" },
  { value: "Sizwe Hosmed", label: "Sizwe Hosmed" },
  { value: "Liberty Health", label: "Liberty Health" },
  { value: "other", label: "Other (specify)" },
];

// Helper: find a country record by stored name.
export function findCountryByName(name: string | null | undefined): Country | undefined {
  if (!name) return undefined;
  return COUNTRIES.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
}

// Helper: split a stored "+27 71 234 5678" into dial + rest.
// Returns { dial: "+27", number: "71 234 5678" } on success, falls back
// to the whole input as `number` if no dial is detectable.
export function splitPhone(stored: string | null | undefined): {
  dial: string;
  number: string;
} {
  if (!stored) return { dial: "+27", number: "" };
  const trimmed = stored.trim();
  if (!trimmed.startsWith("+")) return { dial: "+27", number: trimmed };
  // Longest-prefix match against known dial codes (some codes are 4
  // digits, e.g. +1242 Bahamas — we want to match those before +1).
  const candidates = [...new Set(COUNTRIES.map((c) => c.dial))].sort(
    (a, b) => b.length - a.length
  );
  for (const d of candidates) {
    if (trimmed.startsWith(d)) {
      return { dial: d, number: trimmed.slice(d.length).trim() };
    }
  }
  return { dial: "+27", number: trimmed };
}
