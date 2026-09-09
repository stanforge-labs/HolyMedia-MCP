import { ForbiddenException } from "@nestjs/common";

const messages = {
  invalid_preview_token:
    "Передайте preview_token из результата создания preview, а не ID или ключ доступа.",
  preview_not_found:
    "Preview не найден или недоступен этому ключу. Создайте новый preview тем же ключом.",
  preview_expired: "Срок действия preview истёк. Создайте новый preview.",
  preview_already_consumed:
    "Этот preview уже использован. Для нового изменения создайте новый preview.",
  confirmation_context_mismatch:
    "Контекст preview изменился. Создайте и подтвердите новый preview тем же ключом.",
  invalid_confirmation_arguments:
    "Подтверждение принимает только preview_token. Не передавайте provider, account_id, campaign_id или новое имя.",
  write_scope_required:
    "Для подтверждения изменения нужен ключ в режиме «Контролируемая запись».",
  preview_not_confirmed: "Сначала явно подтвердите этот preview.",
} as const;

export type PreviewErrorCode = keyof typeof messages;

export class PreviewError extends ForbiddenException {
  public readonly publicMessage: string;
  public constructor(
    public readonly code: PreviewErrorCode,
    internalMessage?: string,
  ) {
    super(internalMessage ?? code);
    this.publicMessage = messages[code];
  }
}
