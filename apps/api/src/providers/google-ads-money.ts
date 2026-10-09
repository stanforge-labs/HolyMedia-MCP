import type { Stage1Reader } from "./google-ads-stage1.js";
import { GoogleAdsWriteError } from "./google-ads-write.js";

/** Google v24 currency_constant: no Intl/ISO fraction-digit fallback. */
export type GoogleMoneyUnit = {
  currency: string;
  unit_micros: string;
  resource_name: string;
};
function fail(code: string, message: string): never {
  throw new GoogleAdsWriteError(code, message);
}
export function currencyConstantQuery(currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency))
    fail(
      "google_currency_unit_invalid",
      "Валюта аккаунта не доказана; currency constant не угадывается.",
    );
  return `SELECT currency_constant.resource_name, currency_constant.code, currency_constant.billable_unit_micros FROM currency_constant WHERE currency_constant.code = '${currency}'`;
}
export function moneyUnitFromRows(
  currency: string,
  rows: Awaited<ReturnType<Stage1Reader>>,
): GoogleMoneyUnit {
  currencyConstantQuery(currency);
  if (rows.length !== 1)
    fail(
      "google_currency_unit_unavailable",
      "Google currency_constant отсутствует/неоднозначен; fallback по таблице валют запрещён.",
    );
  const raw = rows[0]?.currencyConstant as Record<string, unknown> | undefined;
  if (
    !raw ||
    raw.code !== currency ||
    raw.resourceName !== `currencyConstants/${currency}`
  )
    fail(
      "google_currency_unit_mismatch",
      "Google currency constant не совпадает с валютой выбранного аккаунта.",
    );
  const n = raw.billableUnitMicros;
  if (
    (typeof n !== "string" && typeof n !== "number") ||
    (typeof n === "number" && !Number.isSafeInteger(n)) ||
    !/^[1-9][0-9]{0,18}$/.test(String(n)) ||
    BigInt(String(n)) > 9223372036854775807n
  )
    fail(
      "google_currency_unit_invalid",
      "billable_unit_micros должен быть доказанным положительным INT64 Google, не дробью/нулём/unsafe Number.",
    );
  return {
    currency,
    unit_micros: String(n),
    resource_name: String(raw.resourceName),
  };
}
export async function resolveGoogleMoneyUnit(
  currency: string,
  read: Stage1Reader,
): Promise<GoogleMoneyUnit> {
  return moneyUnitFromRows(
    currency,
    await read(currencyConstantQuery(currency)),
  );
}
/** One exact rational-to-unit half-up rounding; prevents double-rounding percent. */
export function quantizePositiveMicros(
  numerator: string,
  unit: GoogleMoneyUnit,
  denominator = "1",
): string {
  if (
    !/^[1-9][0-9]*$/.test(numerator) ||
    !/^[1-9][0-9]*$/.test(denominator) ||
    !/^[1-9][0-9]*$/.test(unit.unit_micros)
  )
    fail(
      "google_money_quantization_invalid",
      "Положительная сумма/делитель/доказанная billable unit обязательны.",
    );
  const n = BigInt(numerator),
    d = BigInt(denominator),
    u = BigInt(unit.unit_micros);
  const rounded = ((2n * n + d * u) / (2n * d * u)) * u;
  if (rounded === 0n)
    fail(
      "google_money_rounded_zero",
      "Сумма округляется до нуля Google billable unit; положительная ставка/бюджет не очищаются скрыто.",
    );
  if (rounded > 9999999999999999n)
    fail(
      "google_money_quantization_invalid",
      "Округлённая сумма превышает допустимый money profile.",
    );
  return rounded.toString();
}
export function moneyUnitWarnings(
  numerator: string,
  result: string,
  unit: GoogleMoneyUnit,
  denominator = "1",
): string[] {
  const resultMicros = BigInt(result),
    requested = BigInt(numerator),
    d = BigInt(denominator);
  return [
    `Account currency ${unit.currency}; Google billable_unit_micros=${unit.unit_micros} (${unit.resource_name}).`,
    ...(resultMicros * d !== requested
      ? [
          `Округление по Google billable unit: requested micros=${denominator === "1" ? numerator : `${numerator}/${denominator}`} → ${result}; ${unit.currency}, half-up. Preview/commit используют именно ${result}, не скрытый исходный размер.`,
        ]
      : []),
  ];
}
export function alignedMoneyMicros(
  value: unknown,
  unit: GoogleMoneyUnit,
): boolean {
  return (
    /^[1-9][0-9]*$/.test(String(value)) &&
    BigInt(String(value)) % BigInt(unit.unit_micros) === 0n
  );
}
