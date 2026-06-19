-- ============================================================
-- FFSA Hub — Country Tier master list (FFSA SA financial categories)
-- ============================================================
-- Seeds the authoritative country → tier (A/B/C) backbone used to
-- auto-assign a student's fee tier from their application home country.
--
-- country_tiers (migration 009) already enforces:
--   - UNIQUE (country_name)
--   - tier CHECK IN ('A','B','C')
--   - RLS: only admins / finance_admin may insert/update/delete
--
-- Idempotent: re-running UPDATES the tier to match this list, so this
-- file stays the single source of truth. Editing in-app still works;
-- re-applying this migration would reset to these values.
-- ============================================================

INSERT INTO public.country_tiers (country_name, tier) VALUES
  ('Afghanistan','C'),('Albania','B'),('Algeria','C'),('American Samoa','B'),
  ('Andorra','A'),('Angola','C'),('Anguilla','B'),('Antigua and Barbuda','B'),
  ('Argentina','B'),('Armenia','C'),('Aruba','A'),('Australia','A'),
  ('Austria','A'),('Azerbaijan','C'),('Bahamas','A'),('Bahrain','A'),
  ('Bangladesh','C'),('Barbados','B'),('Belarus','C'),('Belgium','A'),
  ('Belize','C'),('Benin','C'),('Bermuda','A'),('Bhutan','C'),
  ('Bolivia','C'),('Bosnia-Herzegovina','C'),('Botswana','C'),('Bougainville','C'),
  ('Brazil','B'),('British Indian Ocean Territory','A'),('British Virgin Islands','A'),
  ('Brunei','A'),('Bulgaria','B'),('Burkina Faso','C'),('Burundi','C'),
  ('Cambodia','C'),('Cameroon','C'),('Canada','A'),('Cape Verde','C'),
  ('Cayman Islands','A'),('Central African Republic','C'),('Chad','C'),
  ('Channel Islands','A'),('Chile','B'),('China','B'),('Christmas Island','A'),
  ('Cocos (Keeling) Islands','C'),('Colombia','C'),('Comoros','C'),
  ('Congo Brazzaville','C'),('Congo Kinshasa','C'),('Cook Islands','B'),
  ('Costa Rica','B'),('Cote d''Ivoire','C'),('Croatia','B'),('Cuba','B'),
  ('Cyprus','A'),('Czech Republic','A'),('Denmark','A'),('Djibouti','C'),
  ('Dominica','C'),('Dominican Republic','B'),('East Timor','C'),('Ecuador','C'),
  ('Egypt','C'),('El Salvador','C'),('Equatorial Guinea','C'),('Eritrea','C'),
  ('Estonia','A'),('Ethiopia','C'),('Falkland Islands','A'),('Faroe Islands','A'),
  ('Fiji','C'),('Finland','A'),('France','A'),('French Guiana','A'),
  ('French Polynesia','A'),('Gabon','C'),('Gambia','C'),('Georgia','C'),
  ('Germany','A'),('Ghana','C'),('Gibraltar','A'),('Greece','A'),
  ('Greenland','A'),('Grenada','B'),('Guadeloupe','A'),('Guam','A'),
  ('Guatemala','C'),('Guinea','C'),('Guinea-Bissau','C'),('Guyana','C'),
  ('Haiti','C'),('Honduras','C'),('Hong Kong','A'),('Hungary','B'),
  ('Iceland','A'),('India','C'),('Indonesia','C'),('Iran','C'),
  ('Iraq','C'),('Ireland','A'),('Isle of Man','A'),('Israel','A'),
  ('Italy','A'),('Jamaica','C'),('Japan','A'),('Jordan','C'),
  ('Kazakhstan','B'),('Kenya','C'),('Kiribati','C'),('Kosovo','C'),
  ('Kuwait','A'),('Kyrgyzstan','C'),('Laos','C'),('Latvia','A'),
  ('Lebanon','C'),('Lesotho','C'),('Liberia','C'),('Libya','C'),
  ('Liechtenstein','A'),('Lithuania','A'),('Luxembourg','A'),('Macau','A'),
  ('Macedonia','C'),('Madagascar','C'),('Malawi','C'),('Malaysia','B'),
  ('Maldives','B'),('Mali','C'),('Malta','A'),('Marshall Islands','C'),
  ('Martinique','A'),('Mauritania','C'),('Mauritius','B'),('Mayotte','B'),
  ('Mexico','B'),('Micronesia','C'),('Moldova','C'),('Monaco','A'),
  ('Mongolia','C'),('Montenegro','B'),('Montserrat','B'),('Morocco','C'),
  ('Mozambique','C'),('Myanmar','C'),('Namibia','B'),('Nauru','B'),
  ('Nepal','C'),('Netherlands','A'),('Netherlands Antilles','A'),
  ('New Caledonia','A'),('New Zealand','A'),('Nicaragua','C'),('Niger','C'),
  ('Nigeria','C'),('Niue Island','C'),('Norfolk Island','A'),('Northern Cyprus','B'),
  ('Northern Mariana Islands','B'),('North Korea','C'),('Norway','A'),('Oman','A'),
  ('Pakistan','C'),('Palau','B'),('Palestine','C'),('Panama','B'),
  ('Papua New Guinea','C'),('Paraguay','C'),('Peru','B'),('Philippines','C'),
  ('Pitcairn Islands','C'),('Poland','A'),('Portugal','A'),('Puerto Rico','A'),
  ('Qatar','A'),('Reunion','A'),('Romania','B'),('Russia','B'),
  ('Rwanda','C'),('Saint Helena','C'),('Saint Kitts and Nevis','B'),('Saint Lucia','C'),
  ('Saint Martin','A'),('Saint Pierre and Miquelon','A'),
  ('Saint Vincent and the Grenadines','C'),('Samoa','C'),('San Marino','A'),
  ('Sao Tome and Principe','C'),('Saudi Arabia','A'),('Senegal','C'),('Serbia','B'),
  ('Seychelles','B'),('Sierra Leone','C'),('Singapore','A'),('Slovakia','A'),
  ('Slovenia','A'),('Solomon Islands','C'),('Somalia','C'),('South Africa','B'),
  ('South Korea','A'),('South Sudan','C'),('Spain','A'),('Sri Lanka','C'),
  ('Sudan','C'),('Suriname','C'),('Svalbard and Jan Mayen Islands','A'),
  ('Swaziland','C'),('Sweden','A'),('Switzerland','A'),('Syria','C'),
  ('Taiwan','A'),('Tajikistan','C'),('Tanzania','C'),('Thailand','C'),
  ('Togo','C'),('Tokelau Islands','C'),('Tonga','C'),('Trinidad and Tobago','B'),
  ('Tunisia','C'),('Turkey','B'),('Turkmenistan','B'),('Turks and Caicos Islands','A'),
  ('Tuvalu','C'),('Uganda','C'),('Ukraine','B'),('United Arab Emirates','A'),
  ('United Kingdom','A'),('United States of America','A'),('Uruguay','B'),
  ('US Virgin Islands','A'),('Uzbekistan','C'),('Vanuatu','C'),('Vatican City','A'),
  ('Venezuela','C'),('Vietnam','C'),('Wallis and Futuna Islands','C'),
  ('Western Sahara','C'),('Yemen','C'),('Zambia','C'),('Zimbabwe','C')
ON CONFLICT (country_name) DO UPDATE SET tier = EXCLUDED.tier;
