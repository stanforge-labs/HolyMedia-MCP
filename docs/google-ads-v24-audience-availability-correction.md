# v24 audience availability: exact enum correction

Source review against the official v24 enum definitions found a real contract mismatch. The common availability message comments mention legacy spellings, but the actual enum/API values are authoritative:

- Channel: `ALL_CHANNELS`, `CHANNEL_TYPE_AND_ALL_SUBTYPES`, `CHANNEL_TYPE_AND_SUBSET_SUBTYPES`.
- Locale: `ALL_LOCALES`, `COUNTRY_AND_ALL_LANGUAGES`, `LANGUAGE_AND_ALL_COUNTRIES`, `COUNTRY_AND_LANGUAGE`.

The product Stage3 and pure readiness helpers now use the actual global-locale values. The valid `launched_to_all=true` boolean path is unchanged. Matching actual campaign channel/subtype remains mandatory; a subset profile with the default campaign subtype still needs explicit `include_default_channel_sub_type=true`. Unknown/unspecified and obsolete enum spellings fail closed. Country/language-specific profiles remain unsupported by this bounded correction: account currency, timezone, human UI language and an existing Russian keyword are not provider proof of audience locale eligibility.

Primary definitions: [channel enum](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/enums/criterion_category_channel_availability_mode.proto), [locale enum](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/enums/criterion_category_locale_availability_mode.proto), [availability fields](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/common/criterion_category_availability.proto). The last source's explanatory comments use old labels; no compatibility alias is invented in the parser.

Mock regression verifies valid global channel/locale values, wrong channels, constrained/legacy/unknown locales, missing default subtype permission, foreign catalog ownership and immutable catalog checks detecting a changed availability record. No runtime, VPS or Google call was performed by this package. New-source CI/image and a future exact-source READ/preview are needed before any new LIVE eligibility claim. Historical READ artifacts are retained; their zero global-locale count was computed by the old guard and is not proof of zero actual `ALL_LOCALES` rows.
