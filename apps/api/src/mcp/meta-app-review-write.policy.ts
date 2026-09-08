import type { AppConfig } from "@holymedia/config";
import type { MetaControlledCampaignState } from "../providers/provider.types.js";

export type MetaAppReviewPolicyResult =
  | { kind: "not_configured" }
  | { kind: "blocked"; reason: string; message: string }
  | { kind: "allowed"; requestedName: string };

/** Separate, removable exception. It never changes the original exact-name policy. */
export const SECOND_META_APP_REVIEW = Object.freeze({
  workspaceId: "acbf0667-2a34-4ee8-b720-f63581f12eed",
  serviceTokenId: "ae452fdf-788e-44c7-a2dc-5351fdba0681",
  accountId: "act_832949381388598",
  campaignId: "120254614255020709",
  sourceName: "New Awareness Campaign",
  targetName: "New Awareness Campaign - ads_management demo",
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
  serviceTokenId?: string,
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
    if (serviceTokenId !== SECOND_META_APP_REVIEW.serviceTokenId)
      return blocked(
        "service_token_not_allowed",
        "Этот ключ не разрешён для подготовленного переименования.",
      );
    const name = onlyRequestedName(preview.payload);
    if (preview.operation !== "change_name" || !name || name.length > 255)
      return blocked(
        "payload_not_name_only",
        "Используйте preview_change_campaign_name: разрешено изменить только название подготовленной кампании.",
      );
    if (name !== SECOND_META_APP_REVIEW.targetName)
      return blocked(
        "target_name_not_allowed",
        "Новое название не соответствует разрешённому переименованию.",
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
    if (name !== SECOND_META_APP_REVIEW.targetName)
      return blocked(
        "target_name_not_allowed",
        "Новое название не соответствует разрешённому переименованию.",
      );
    if (state.name !== SECOND_META_APP_REVIEW.sourceName)
      return blocked(
        "current_name_not_expected",
        "Название кампании не соответствует подготовленному состоянию для переименования.",
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
