import { ForbiddenException } from "@nestjs/common";

const messages = {
  google_preview_stale:
    "Объект изменился после создания preview. Создайте новый preview.",
  invalid_preview_token:
    "Передайте preview_token из результата создания preview, а не ID или ключ доступа.",
  preview_not_found:
    "Preview не найден или недоступен этому ключу. Создайте новый preview тем же ключом.",
  approval_not_found:
    "Ссылка подтверждения недействительна или недоступна этой учётной записи.",
  preview_cancelled:
    "Этот preview отменён. Создайте новый preview для другого изменения.",
  preview_already_confirmed:
    "Это изменение уже подтверждено. Вернитесь в AI-клиент для выполнения.",
  preview_expired: "Срок действия preview истёк. Создайте новый preview.",
  preview_already_consumed:
    "Этот preview уже использован. Для нового изменения создайте новый preview.",
  confirmation_context_mismatch:
    "Контекст preview изменился. Создайте и подтвердите новый preview тем же ключом.",
  invalid_confirmation_arguments:
    "Подтверждение принимает только preview_token. Не передавайте provider, account_id, campaign_id или новое имя.",
  write_scope_required:
    "Для подтверждения изменения нужен ключ в режиме «Контролируемая запись».",
  preview_not_confirmed:
    "Сначала подтвердите этот preview в HolyMedia через ссылку из результата preview.",
  preview_stale:
    "Кампания изменилась после preview. Создайте новый preview и подтвердите его.",
  public_write_disabled:
    "Публичная контролируемая запись пока выключена. Preview можно создать и подтвердить, но изменение не будет отправлено в Meta.",
  public_operation_not_available:
    "Этот инструмент или операция недоступны через публичный MCP endpoint.",
  preview_no_change:
    "Запрошенное состояние уже установлено. Новое изменение не требуется.",
  provider_outcome_uncertain:
    "Результат изменения в Meta не удалось подтвердить. Не повторяйте commit; проверьте кампанию и обратитесь в поддержку.",
  verification_mismatch:
    "Meta ответила, но повторное чтение не подтвердило запрошенное состояние. Не повторяйте commit; создайте новый preview после проверки кампании.",
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
