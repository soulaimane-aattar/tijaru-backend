-- Revert 003-types
BEGIN;

DROP TYPE IF EXISTS app."WebhookDeliveryStatus";
DROP TYPE IF EXISTS app."Unit";
DROP TYPE IF EXISTS app."SubscriptionPlan";
DROP TYPE IF EXISTS app."PurchaseOrderStatus";
DROP TYPE IF EXISTS app."PaymentMethod";
DROP TYPE IF EXISTS app."OrderStatus";
DROP TYPE IF EXISTS app."OcrStatus";
DROP TYPE IF EXISTS app."NotificationType";
DROP TYPE IF EXISTS app."MovementType";
DROP TYPE IF EXISTS app."MovementReason";
DROP TYPE IF EXISTS app."InvoiceStatus";
DROP TYPE IF EXISTS app."EstimateStatus";
DROP TYPE IF EXISTS app."DeliveryNoteType";
DROP TYPE IF EXISTS app."DeliveryNoteStatus";
DROP TYPE IF EXISTS app."BusinessStatus";
DROP TYPE IF EXISTS app."BuiltInRole";
DROP TYPE IF EXISTS app."BonPaymentMethod";

COMMIT;
