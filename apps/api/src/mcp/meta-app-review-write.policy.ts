import type { AppConfig } from "@holymedia/config";
import type { MetaControlledCampaignState } from "../providers/provider.types.js";

export type MetaAppReviewPolicyResult =
  | { kind: "not_configured" }
  | { kind: "blocked"; reason: string; message: string }
  | { kind: "allowed"; requestedName: string };

/** Separate, removable exception. It never changes the original exact-name policy. */
export const SECOND_META_APP_REVIEW = Object.freeze({
  workspaceId: "ed88172a-fe04-58e3-a66d-cd0c2d911292",
  accountId: "act_832949381388598",
  campaignId: "120254614255020709",
});

/** Narrow server-side policies; global confirmed writes are not required. */
export function evaluateMetaAppReviewRenamePolicy(
  config: AppConfig,
  preview: {
    provider: string;
    operation: string;
    externalObjectId: string;
    payload: unknown;
  },
  account: { externalAccountId: string },
  workspaceId?: string,
): MetaAppReviewPolicyResult {
  if (
    config.metaAppReviewSecondRenameEnabled &&
    preview.provider === "META_ADS" &&
    account.externalAccountId === SECOND_META_APP_REVIEW.accountId &&
    preview.externalObjectId === SECOND_META_APP_REVIEW.campaignId
  ) {
    if (workspaceId !== SECOND_META_APP_REVIEW.workspaceId)
      return blocked(
        "workspace_not_allowed",
        "Изменение этой кампании не разрешено текущей политикой.",
      );
    const name = onlyRequestedName(preview.payload);
    if (preview.operation !== "change_name" || !name || name.length > 255)
      return blocked(
        "payload_not_name_only",
        "Разрешено изменить только название подготовленной кампании (от 1 до 255 символов).",
      );
    return { kind: "allowed", requestedName: name };
  }
  if (!config.metaAppReviewRenameEnabled) return { kind: "not_configured" };
  const requestedName = onlyRequestedName(preview.payload);
  if (preview.provider !== "META_ADS")
    return blocked(
      "provider_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (account.externalAccountId !== config.metaAppReviewRenameAccountId)
    return blocked(
      "account_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (preview.externalObjectId !== config.metaAppReviewRenameCampaignId)
    return blocked(
      "campaign_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (preview.operation !== "change_name")
    return blocked(
      "operation_not_allowed",
      "Разрешено изменить только название подготовленной кампании.",
    );
  if (!requestedName)
    return blocked(
      "payload_not_name_only",
      "Разрешено изменить только название подготовленной кампании.",
    );
  if (requestedName !== config.metaAppReviewRenameTargetName)
    return blocked(
      "target_name_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (
    !config.metaAppReviewRenameExpectedName ||
    !config.metaAppReviewRenameTargetName ||
    !config.metaAppReviewRenameAccountId ||
    !config.metaAppReviewRenameCampaignId
  )
    return blocked(
      "policy_incomplete",
      "Контролируемое переименование не настроено.",
    );
  return { kind: "allowed", requestedName };
}

export function evaluateMetaAppReviewPrecondition(
  config: AppConfig,
  state: MetaControlledCampaignState,
  requestedName?: string,
): MetaAppReviewPolicyResult {
  if (state.status !== "PAUSED")
    return blocked(
      "campaign_not_paused",
      "Переименование разрешено только для подготовленной кампании в статусе PAUSED.",
    );
  if (
    config.metaAppReviewSecondRenameEnabled &&
    state.id === SECOND_META_APP_REVIEW.campaignId &&
    state.accountId === SECOND_META_APP_REVIEW.accountId
  ) {
    const name = requestedName?.trim();
    if (!name || name.length > 255)
      return blocked(
        "target_name_required",
        "Укажите новое название кампании (от 1 до 255 символов).",
      );
    return { kind: "allowed", requestedName: name };
  }
  if (state.name === config.metaAppReviewRenameTargetName)
    return { kind: "allowed", requestedName: state.name };
  if (state.name !== config.metaAppReviewRenameExpectedName)
    return blocked(
      "current_name_not_expected",
      "Название кампании не соответствует подготовленному состоянию для переименования.",
    );
  return {
    kind: "allowed",
    requestedName: config.metaAppReviewRenameTargetName,
  };
}

export function invariantChanges(
  before: MetaControlledCampaignState,
  after: MetaControlledCampaignState,
): string[] {
  const fields: Array<keyof MetaControlledCampaignState> = [
    "status",
    "effectiveStatus",
    "objective",
    "dailyBudget",
    "lifetimeBudget",
    "buyingType",
    "startTime",
    "stopTime",
  ];
  return fields.filter((field) => before[field] !== after[field]);
}

function onlyRequestedName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== "new_name") return null;
  const value = entries[0]?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function blocked(reason: string, message: string): MetaAppReviewPolicyResult {
  return { kind: "blocked", reason, message };
}
