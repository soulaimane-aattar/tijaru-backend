-- Deploy 003-types: All enum types in app schema
BEGIN;

CREATE TYPE app."BonPaymentMethod" AS ENUM (
    'cash',
    'card',
    'transfer',
    'other'
);

CREATE TYPE app."BuiltInRole" AS ENUM (
    'owner',
    'admin',
    'manager',
    'stockkeeper',
    'cashier',
    'viewer'
);

CREATE TYPE app."BusinessStatus" AS ENUM (
    'active',
    'suspended',
    'pending',
    'rejected'
);

CREATE TYPE app."DeliveryNoteStatus" AS ENUM (
    'prepared',
    'sent',
    'shipped',
    'partial',
    'delivered',
    'closed',
    'cancelled'
);

CREATE TYPE app."DeliveryNoteType" AS ENUM (
    'order',
    'out',
    'in_',
    'retour'
);

CREATE TYPE app."EstimateStatus" AS ENUM (
    'draft',
    'sent',
    'accepted',
    'rejected',
    'expired',
    'cancelled'
);

CREATE TYPE app."InvoiceStatus" AS ENUM (
    'draft',
    'sent',
    'partial',
    'paid',
    'overdue',
    'cancelled'
);

CREATE TYPE app."MovementReason" AS ENUM (
    'achat',
    'vente',
    'transfert',
    'peremption',
    'ajustement',
    'casse',
    'retour'
);

CREATE TYPE app."MovementType" AS ENUM (
    'in',
    'out',
    'transfer'
);

CREATE TYPE app."NotificationType" AS ENUM (
    'lowStock',
    'expiring',
    'userInvited',
    'poReceived',
    'variance',
    'outOfStock',
    'orderReceived',
    'orderStatus'
);

CREATE TYPE app."OcrStatus" AS ENUM (
    'pending',
    'done',
    'failed'
);

CREATE TYPE app."OrderStatus" AS ENUM (
    'pending',
    'confirmed',
    'in_progress',
    'shipped',
    'delivered',
    'cancelled'
);

CREATE TYPE app."PaymentMethod" AS ENUM (
    'cash',
    'card',
    'credit',
    'split'
);

CREATE TYPE app."PurchaseOrderStatus" AS ENUM (
    'draft',
    'sent',
    'partiallyReceived',
    'received',
    'cancelled'
);

CREATE TYPE app."SubscriptionPlan" AS ENUM (
    'trial',
    'active',
    'expired',
    'suspended'
);

CREATE TYPE app."Unit" AS ENUM (
    'piece',
    'kg',
    'g',
    'litre',
    'ml',
    'carton',
    'pack'
);

CREATE TYPE app."WebhookDeliveryStatus" AS ENUM (
    'pending',
    'ok',
    'failed'
);

COMMIT;
