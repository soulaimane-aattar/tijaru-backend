-- Verify 003-types
DO $$ BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'BonPaymentMethod');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'BuiltInRole');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'BusinessStatus');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'DeliveryNoteStatus');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'DeliveryNoteType');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'EstimateStatus');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'InvoiceStatus');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'MovementReason');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'MovementType');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'NotificationType');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'OcrStatus');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'OrderStatus');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'PaymentMethod');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'PurchaseOrderStatus');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'SubscriptionPlan');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'Unit');
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'app' AND t.typname = 'WebhookDeliveryStatus');
END $$;
ROLLBACK;
