-- Deploy 004-tables: All tables in app / app_auth / public schemas
-- Column names preserved exactly from Prisma (camelCase where applicable).
-- RLS is NOT enabled here — see 005-rls.
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PUBLIC SCHEMA — platform-level, no tenant scoping
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.platform_admins (
    id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    "passwordHash" text NOT NULL,
    "tokenVersion" integer DEFAULT 0 NOT NULL,
    "totpSecret" text,
    "totpEnabledAt" timestamp(3) without time zone,
    "totpLastStep" integer,
    "mfaFailures" integer DEFAULT 0 NOT NULL,
    "mfaLockedUntil" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.platform_audit_logs (
    id text NOT NULL,
    action text NOT NULL,
    tone text DEFAULT 'ok'::text NOT NULL,
    target_type text DEFAULT 'business'::text NOT NULL,
    target_id text,
    target_name text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- APP SCHEMA — core business logic
-- ═══════════════════════════════════════════════════════════════════════════════

-- businesses first: nearly everything FKs here
CREATE TABLE app.businesses (
    id text NOT NULL,
    name text NOT NULL,
    ice text,
    rc text,
    patente text,
    if_num text,
    cnss text,
    address text,
    city text,
    phone text,
    logo text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    created_by text,
    status app."BusinessStatus" DEFAULT 'active'::app."BusinessStatus" NOT NULL,
    max_products integer DEFAULT 100 NOT NULL,
    max_users integer DEFAULT 5 NOT NULL,
    max_warehouses integer DEFAULT 2 NOT NULL,
    plan app."SubscriptionPlan" DEFAULT 'trial'::app."SubscriptionPlan" NOT NULL,
    subscription_end timestamp(3) without time zone,
    subscription_start timestamp(3) without time zone,
    enabled_vat_rates integer[] DEFAULT ARRAY[0, 7, 10, 14, 20] NOT NULL,
    multi_warehouse boolean DEFAULT true NOT NULL,
    bons_affect_stock boolean DEFAULT true NOT NULL,
    default_vat_rate integer DEFAULT 20 NOT NULL
);

CREATE TABLE app.categories (
    id text NOT NULL,
    name text NOT NULL,
    icon text NOT NULL,
    tone text NOT NULL,
    business_id text NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE app.suppliers (
    id text NOT NULL,
    name text NOT NULL,
    contact text,
    phone text,
    city text,
    ice text,
    email text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.warehouses (
    id text NOT NULL,
    name text NOT NULL,
    city text NOT NULL,
    address text,
    phone text,
    active boolean DEFAULT true NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "managerId" text,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.price_groups (
    id text NOT NULL,
    business_id text NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.customers (
    id text NOT NULL,
    name text NOT NULL,
    phone text,
    city text,
    ice text,
    purchases numeric(14,2) DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    business_id text NOT NULL,
    credit_limit numeric(14,2),
    buyer_business_id text,
    price_group_id text
);

CREATE TABLE app.products (
    id text NOT NULL,
    name text NOT NULL,
    barcode text NOT NULL,
    sku text NOT NULL,
    "categoryId" text NOT NULL,
    purchase numeric(12,2) NOT NULL,
    sale numeric(12,2) NOT NULL,
    vat integer NOT NULL,
    unit app."Unit" DEFAULT 'piece'::app."Unit" NOT NULL,
    "supplierId" text,
    "trackExpiry" boolean DEFAULT false NOT NULL,
    expiry timestamp(3) without time zone,
    batch text,
    "minStock" integer DEFAULT 0 NOT NULL,
    "maxStock" integer DEFAULT 0 NOT NULL,
    notes text,
    tone text DEFAULT '#94a3b8'::text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    business_id text NOT NULL,
    image_path text,
    name_fr text
);

CREATE TABLE app.stock_levels (
    "productId" text NOT NULL,
    "warehouseId" text NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    "businessId" text NOT NULL,
    "reservedQty" integer DEFAULT 0 NOT NULL,
    "avgCost" numeric(12,4) DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.movements (
    id text NOT NULL,
    type app."MovementType" NOT NULL,
    "productId" text NOT NULL,
    qty integer NOT NULL,
    "warehouseId" text NOT NULL,
    "toWarehouseId" text,
    "userId" text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reason app."MovementReason" NOT NULL,
    ref text,
    batch text,
    expiry timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.purchase_orders (
    id text NOT NULL,
    number text NOT NULL,
    "supplierId" text NOT NULL,
    "warehouseId" text NOT NULL,
    status app."PurchaseOrderStatus" DEFAULT 'draft'::app."PurchaseOrderStatus" NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.purchase_order_lines (
    id text NOT NULL,
    "purchaseOrderId" text NOT NULL,
    "productId" text NOT NULL,
    qty integer NOT NULL,
    price numeric(12,2) NOT NULL,
    vat integer NOT NULL,
    received integer DEFAULT 0 NOT NULL
);

CREATE TABLE app.po_sessions (
    id text NOT NULL,
    "openedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "closedAt" timestamp(3) without time zone,
    "openingFloat" numeric(12,2) DEFAULT 0 NOT NULL,
    sales integer DEFAULT 0 NOT NULL,
    revenue numeric(14,2) DEFAULT 0 NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.po_tickets (
    id text NOT NULL,
    number text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "cashierId" text NOT NULL,
    "warehouseId" text NOT NULL,
    "customerId" text,
    "sessionId" text NOT NULL,
    ht numeric(14,2) NOT NULL,
    tva numeric(14,2) NOT NULL,
    total numeric(14,2) NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    due numeric(14,2) DEFAULT 0 NOT NULL,
    payment jsonb NOT NULL,
    parked boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.po_ticket_lines (
    id text NOT NULL,
    "ticketId" text NOT NULL,
    "productId" text NOT NULL,
    qty integer NOT NULL,
    "priceTtc" numeric(12,2) NOT NULL,
    vat integer NOT NULL
);

CREATE TABLE app.inventory_counts (
    id text NOT NULL,
    "warehouseId" text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "appliedAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.inventory_count_lines (
    id text NOT NULL,
    "countId" text NOT NULL,
    "productId" text NOT NULL,
    expected integer NOT NULL,
    counted integer NOT NULL
);

CREATE TABLE app.invoices (
    id text NOT NULL,
    business_id text NOT NULL,
    number text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    due_date timestamp(3) without time zone NOT NULL,
    customer_id text NOT NULL,
    issued_by_id text NOT NULL,
    status app."InvoiceStatus" DEFAULT 'draft'::app."InvoiceStatus" NOT NULL,
    ht numeric(14,2) NOT NULL,
    tva numeric(14,2) NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) NOT NULL,
    paid numeric(14,2) DEFAULT 0 NOT NULL,
    notes text,
    terms text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.invoice_lines (
    id text NOT NULL,
    invoice_id text NOT NULL,
    product_id text NOT NULL,
    label text NOT NULL,
    qty numeric(12,3) NOT NULL,
    price_ht numeric(12,2) NOT NULL,
    vat integer NOT NULL,
    discount numeric(12,2) DEFAULT 0 NOT NULL
);

CREATE TABLE app.estimates (
    id text NOT NULL,
    business_id text NOT NULL,
    number text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    valid_until timestamp(3) without time zone NOT NULL,
    customer_id text NOT NULL,
    issued_by_id text NOT NULL,
    status app."EstimateStatus" DEFAULT 'draft'::app."EstimateStatus" NOT NULL,
    ht numeric(14,2) NOT NULL,
    tva numeric(14,2) NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) NOT NULL,
    notes text,
    terms text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.estimate_lines (
    id text NOT NULL,
    estimate_id text NOT NULL,
    product_id text NOT NULL,
    label text NOT NULL,
    qty numeric(12,3) NOT NULL,
    price_ht numeric(12,2) NOT NULL,
    vat integer NOT NULL,
    discount numeric(12,2) DEFAULT 0 NOT NULL
);

CREATE TABLE app.delivery_notes (
    id text NOT NULL,
    business_id text NOT NULL,
    number text NOT NULL,
    type app."DeliveryNoteType" NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status app."DeliveryNoteStatus" DEFAULT 'prepared'::app."DeliveryNoteStatus" NOT NULL,
    customer_id text,
    supplier_id text,
    issued_by_id text NOT NULL,
    source_ref text,
    carrier text,
    signed boolean DEFAULT false NOT NULL,
    signed_at timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    paid numeric(14,2) DEFAULT 0 NOT NULL,
    return_of_id text
);

CREATE TABLE app.delivery_note_lines (
    id text NOT NULL,
    delivery_note_id text NOT NULL,
    product_id text NOT NULL,
    label text NOT NULL,
    ordered numeric(12,3) NOT NULL,
    sent numeric(12,3) DEFAULT 0 NOT NULL,
    unit_price numeric(12,2) DEFAULT 0 NOT NULL
);

CREATE TABLE app.delivery_note_payments (
    id text NOT NULL,
    business_id text NOT NULL,
    delivery_note_id text NOT NULL,
    amount numeric(14,2) NOT NULL,
    method app."BonPaymentMethod" DEFAULT 'cash'::app."BonPaymentMethod" NOT NULL,
    note text,
    created_by_id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE app.expense_category_defs (
    id text NOT NULL,
    business_id text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    tax_rate numeric(5,2) DEFAULT 20.00 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.expenses (
    id text NOT NULL,
    business_id text NOT NULL,
    warehouse_id text,
    date timestamp(3) without time zone NOT NULL,
    amount numeric(12,2) NOT NULL,
    tax_amount numeric(12,2),
    category text DEFAULT 'other'::text NOT NULL,
    supplier_id text,
    merchant_name text,
    note text,
    payment_method app."PaymentMethod" DEFAULT 'cash'::app."PaymentMethod" NOT NULL,
    receipt_path text,
    ocr_status app."OcrStatus",
    ocr_raw jsonb,
    created_by_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    receipt_hash character(64)
);

CREATE TABLE app.expense_photos (
    id text NOT NULL,
    expense_id text NOT NULL,
    path text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE app.notifications (
    id text NOT NULL,
    type app."NotificationType" NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read boolean DEFAULT false NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app.activities (
    id text NOT NULL,
    "userId" text,
    action text NOT NULL,
    "desc" text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    device text,
    business_id text NOT NULL
);

CREATE TABLE app.business_modules (
    business_id text NOT NULL,
    module_id text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.document_audits (
    id text NOT NULL,
    business_id text NOT NULL,
    doc_type text NOT NULL,
    doc_id text NOT NULL,
    doc_number text NOT NULL,
    action text NOT NULL,
    changes jsonb,
    user_id text NOT NULL,
    user_name text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE app.listings (
    id text NOT NULL,
    business_id text NOT NULL,
    product_id text NOT NULL,
    title text NOT NULL,
    description text,
    unit_price numeric(12,2) NOT NULL,
    vat integer NOT NULL,
    unit app."Unit" DEFAULT 'piece'::app."Unit" NOT NULL,
    min_order_qty integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.listing_tiers (
    id text NOT NULL,
    listing_id text NOT NULL,
    price_group_id text,
    min_qty integer NOT NULL,
    unit_price numeric(12,2) NOT NULL
);

CREATE TABLE app.orders (
    id text NOT NULL,
    number text NOT NULL,
    seller_business_id text NOT NULL,
    buyer_business_id text NOT NULL,
    customer_id text NOT NULL,
    status app."OrderStatus" DEFAULT 'pending'::app."OrderStatus" NOT NULL,
    subtotal_ht numeric(14,2) NOT NULL,
    vat_total numeric(14,2) NOT NULL,
    total_ttc numeric(14,2) NOT NULL,
    buyer_note text,
    seller_note text,
    external_ref text,
    source text DEFAULT 'tijaru'::text NOT NULL,
    created_by_user_id text,
    status_changed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.order_lines (
    id text NOT NULL,
    order_id text NOT NULL,
    listing_id text NOT NULL,
    product_id text NOT NULL,
    name text NOT NULL,
    qty integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    vat integer NOT NULL,
    total_ht numeric(14,2) NOT NULL
);

CREATE TABLE app.webhooks (
    id text NOT NULL,
    business_id text NOT NULL,
    url text NOT NULL,
    secret text NOT NULL,
    events text[],
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.webhook_deliveries (
    id text NOT NULL,
    webhook_id text NOT NULL,
    event text NOT NULL,
    payload jsonb NOT NULL,
    status app."WebhookDeliveryStatus" DEFAULT 'pending'::app."WebhookDeliveryStatus" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.api_keys (
    id text NOT NULL,
    business_id text NOT NULL,
    name text NOT NULL,
    prefix text NOT NULL,
    hash text NOT NULL,
    last_used_at timestamp(3) without time zone,
    revoked_at timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE app.attendances (
    id text NOT NULL,
    business_id text NOT NULL,
    user_id text NOT NULL,
    check_in timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    check_out timestamp(3) without time zone,
    worked_hours double precision,
    lat_in double precision NOT NULL,
    lng_in double precision NOT NULL,
    lat_out double precision,
    lng_out double precision,
    note text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE app.attendance_pauses (
    id text NOT NULL,
    attendance_id text NOT NULL,
    started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp(3) without time zone
);

CREATE TABLE app.bug_reports (
    id text NOT NULL,
    business_id text NOT NULL,
    user_id text NOT NULL,
    type text DEFAULT 'bug'::text NOT NULL,
    description text NOT NULL,
    screenshot text,
    pin_x double precision,
    pin_y double precision,
    screen text,
    device_info text,
    app_version text,
    note text,
    zone jsonb,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- APP_AUTH SCHEMA — authentication & authorization
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE app_auth.users (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text,
    "passwordHash" text NOT NULL,
    role app."BuiltInRole" NOT NULL,
    "tokenVersion" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "lastLogin" timestamp(3) without time zone,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    business_id text NOT NULL,
    restrict_modules boolean DEFAULT false NOT NULL,
    module_access text[] DEFAULT ARRAY[]::text[] NOT NULL
);

CREATE TABLE app_auth.sessions (
    id text NOT NULL,
    "userId" text NOT NULL,
    "refreshTokenHash" text NOT NULL,
    device text,
    os text,
    ip text,
    city text,
    "userAgent" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE app_auth.security_policies (
    id text NOT NULL,
    "businessId" text NOT NULL,
    "passwordMinLen" integer DEFAULT 8 NOT NULL,
    "requireUpper" boolean DEFAULT true NOT NULL,
    "requireDigit" boolean DEFAULT true NOT NULL,
    "requireSymbol" boolean DEFAULT false NOT NULL,
    "passwordExpiryDays" integer DEFAULT 0 NOT NULL,
    "passwordHistoryCount" integer DEFAULT 0 NOT NULL,
    "twoFARequiredFor" text[] DEFAULT ARRAY[]::text[],
    "lockAfterFailures" integer DEFAULT 5 NOT NULL,
    "sessionTimeoutMin" integer DEFAULT 60 NOT NULL,
    "ipAllowlist" text[] DEFAULT ARRAY[]::text[],
    "auditRetentionDays" integer DEFAULT 365 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE app_auth.custom_roles (
    id text NOT NULL,
    name text NOT NULL,
    tone text NOT NULL,
    inherits app."BuiltInRole",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app_auth.role_capabilities (
    "customRoleId" text NOT NULL,
    "capId" text NOT NULL,
    granted boolean NOT NULL
);

CREATE TABLE app_auth.role_customizations (
    role app."BuiltInRole" NOT NULL,
    "capId" text NOT NULL,
    granted boolean NOT NULL,
    business_id text NOT NULL
);

CREATE TABLE app_auth.user_overrides (
    "userId" text NOT NULL,
    "capId" text NOT NULL,
    granted boolean NOT NULL
);

CREATE TABLE app_auth.user_warehouses (
    "userId" text NOT NULL,
    "warehouseId" text NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PRIMARY KEYS
-- ═══════════════════════════════════════════════════════════════════════════════

-- public
ALTER TABLE ONLY public.platform_admins ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.platform_audit_logs ADD CONSTRAINT platform_audit_logs_pkey PRIMARY KEY (id);

-- app
ALTER TABLE ONLY app.businesses ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.categories ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.warehouses ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.price_groups ADD CONSTRAINT price_groups_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.stock_levels ADD CONSTRAINT stock_levels_pkey PRIMARY KEY ("productId", "warehouseId");
ALTER TABLE ONLY app.movements ADD CONSTRAINT movements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.purchase_orders ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.purchase_order_lines ADD CONSTRAINT purchase_order_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.po_sessions ADD CONSTRAINT po_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.po_tickets ADD CONSTRAINT po_tickets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.po_ticket_lines ADD CONSTRAINT po_ticket_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.inventory_counts ADD CONSTRAINT inventory_counts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.inventory_count_lines ADD CONSTRAINT inventory_count_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.invoice_lines ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.estimates ADD CONSTRAINT estimates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.estimate_lines ADD CONSTRAINT estimate_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.delivery_notes ADD CONSTRAINT delivery_notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.delivery_note_lines ADD CONSTRAINT delivery_note_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.delivery_note_payments ADD CONSTRAINT delivery_note_payments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.expense_category_defs ADD CONSTRAINT expense_category_defs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.expenses ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.expense_photos ADD CONSTRAINT expense_photos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.activities ADD CONSTRAINT activities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.business_modules ADD CONSTRAINT business_modules_pkey PRIMARY KEY (business_id, module_id);
ALTER TABLE ONLY app.document_audits ADD CONSTRAINT document_audits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.listings ADD CONSTRAINT listings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.listing_tiers ADD CONSTRAINT listing_tiers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.order_lines ADD CONSTRAINT order_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.webhooks ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.webhook_deliveries ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.attendances ADD CONSTRAINT attendances_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.attendance_pauses ADD CONSTRAINT attendance_pauses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app.bug_reports ADD CONSTRAINT bug_reports_pkey PRIMARY KEY (id);

-- app_auth
ALTER TABLE ONLY app_auth.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app_auth.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app_auth.security_policies ADD CONSTRAINT security_policies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app_auth.custom_roles ADD CONSTRAINT custom_roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app_auth.role_capabilities ADD CONSTRAINT role_capabilities_pkey PRIMARY KEY ("customRoleId", "capId");
ALTER TABLE ONLY app_auth.role_customizations ADD CONSTRAINT role_customizations_pkey PRIMARY KEY (business_id, role, "capId");
ALTER TABLE ONLY app_auth.user_overrides ADD CONSTRAINT user_overrides_pkey PRIMARY KEY ("userId", "capId");
ALTER TABLE ONLY app_auth.user_warehouses ADD CONSTRAINT user_warehouses_pkey PRIMARY KEY ("userId", "warehouseId");

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

-- public
CREATE UNIQUE INDEX platform_admins_email_key ON public.platform_admins USING btree (email);
CREATE INDEX platform_audit_logs_created_at_idx ON public.platform_audit_logs USING btree (created_at);

-- app
CREATE UNIQUE INDEX businesses_ice_key ON app.businesses USING btree (ice);
CREATE INDEX categories_business_id_idx ON app.categories USING btree (business_id);
CREATE UNIQUE INDEX categories_business_id_name_key ON app.categories USING btree (business_id, name);
CREATE INDEX suppliers_business_id_idx ON app.suppliers USING btree (business_id);
CREATE INDEX warehouses_business_id_idx ON app.warehouses USING btree (business_id);
CREATE UNIQUE INDEX price_groups_business_id_name_key ON app.price_groups USING btree (business_id, name);
CREATE INDEX price_groups_business_id_idx ON app.price_groups USING btree (business_id);
CREATE INDEX customers_business_id_idx ON app.customers USING btree (business_id);
CREATE UNIQUE INDEX customers_business_id_buyer_business_id_key ON app.customers USING btree (business_id, buyer_business_id);
CREATE INDEX customers_price_group_id_idx ON app.customers USING btree (price_group_id);
CREATE INDEX products_business_id_idx ON app.products USING btree (business_id);
CREATE UNIQUE INDEX products_business_id_barcode_key ON app.products USING btree (business_id, barcode);
CREATE UNIQUE INDEX products_business_id_sku_key ON app.products USING btree (business_id, sku);
CREATE INDEX "products_categoryId_idx" ON app.products USING btree ("categoryId");
CREATE INDEX "products_supplierId_idx" ON app.products USING btree ("supplierId");
CREATE INDEX "stock_levels_businessId_productId_idx" ON app.stock_levels USING btree ("businessId", "productId");
CREATE INDEX "stock_levels_warehouseId_idx" ON app.stock_levels USING btree ("warehouseId");
CREATE INDEX movements_business_id_idx ON app.movements USING btree (business_id);
CREATE INDEX "movements_productId_idx" ON app.movements USING btree ("productId");
CREATE INDEX "movements_warehouseId_idx" ON app.movements USING btree ("warehouseId");
CREATE INDEX movements_date_idx ON app.movements USING btree (date);
CREATE INDEX purchase_orders_business_id_idx ON app.purchase_orders USING btree (business_id);
CREATE UNIQUE INDEX purchase_orders_business_id_number_key ON app.purchase_orders USING btree (business_id, number);
CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON app.purchase_order_lines USING btree ("purchaseOrderId");
CREATE INDEX po_sessions_business_id_idx ON app.po_sessions USING btree (business_id);
CREATE INDEX po_tickets_business_id_idx ON app.po_tickets USING btree (business_id);
CREATE UNIQUE INDEX po_tickets_business_id_number_key ON app.po_tickets USING btree (business_id, number);
CREATE INDEX "po_tickets_cashierId_idx" ON app.po_tickets USING btree ("cashierId");
CREATE INDEX "po_tickets_sessionId_idx" ON app.po_tickets USING btree ("sessionId");
CREATE INDEX po_tickets_date_idx ON app.po_tickets USING btree (date);
CREATE INDEX "po_ticket_lines_ticketId_idx" ON app.po_ticket_lines USING btree ("ticketId");
CREATE INDEX inventory_counts_business_id_idx ON app.inventory_counts USING btree (business_id);
CREATE INDEX "inventory_count_lines_countId_idx" ON app.inventory_count_lines USING btree ("countId");
CREATE INDEX invoices_business_id_date_idx ON app.invoices USING btree (business_id, date);
CREATE UNIQUE INDEX invoices_business_id_number_key ON app.invoices USING btree (business_id, number);
CREATE INDEX invoices_business_id_status_idx ON app.invoices USING btree (business_id, status);
CREATE INDEX invoices_customer_id_idx ON app.invoices USING btree (customer_id);
CREATE INDEX invoice_lines_invoice_id_idx ON app.invoice_lines USING btree (invoice_id);
CREATE INDEX estimates_business_id_date_idx ON app.estimates USING btree (business_id, date);
CREATE UNIQUE INDEX estimates_business_id_number_key ON app.estimates USING btree (business_id, number);
CREATE INDEX estimates_business_id_status_idx ON app.estimates USING btree (business_id, status);
CREATE INDEX estimates_customer_id_idx ON app.estimates USING btree (customer_id);
CREATE INDEX estimate_lines_estimate_id_idx ON app.estimate_lines USING btree (estimate_id);
CREATE INDEX delivery_notes_business_id_date_idx ON app.delivery_notes USING btree (business_id, date);
CREATE UNIQUE INDEX delivery_notes_business_id_number_key ON app.delivery_notes USING btree (business_id, number);
CREATE INDEX delivery_notes_business_id_status_idx ON app.delivery_notes USING btree (business_id, status);
CREATE INDEX delivery_notes_business_id_type_idx ON app.delivery_notes USING btree (business_id, type);
CREATE INDEX delivery_notes_customer_id_idx ON app.delivery_notes USING btree (customer_id);
CREATE INDEX delivery_notes_return_of_id_idx ON app.delivery_notes USING btree (return_of_id);
CREATE INDEX delivery_note_lines_delivery_note_id_idx ON app.delivery_note_lines USING btree (delivery_note_id);
CREATE INDEX "delivery_note_payments_business_id_createdAt_idx" ON app.delivery_note_payments USING btree (business_id, "createdAt");
CREATE INDEX delivery_note_payments_delivery_note_id_idx ON app.delivery_note_payments USING btree (delivery_note_id);
CREATE UNIQUE INDEX expense_category_defs_business_id_key_key ON app.expense_category_defs USING btree (business_id, key);
CREATE INDEX expense_category_defs_business_id_archived_sort_order_idx ON app.expense_category_defs USING btree (business_id, archived, sort_order);
CREATE INDEX expenses_business_id_date_idx ON app.expenses USING btree (business_id, date);
CREATE INDEX expenses_business_id_category_idx ON app.expenses USING btree (business_id, category);
CREATE INDEX expenses_business_id_receipt_hash_idx ON app.expenses USING btree (business_id, receipt_hash);
CREATE INDEX expense_photos_expense_id_idx ON app.expense_photos USING btree (expense_id);
CREATE INDEX notifications_business_id_idx ON app.notifications USING btree (business_id);
CREATE INDEX notifications_date_idx ON app.notifications USING btree (date);
CREATE INDEX activities_business_id_idx ON app.activities USING btree (business_id);
CREATE INDEX activities_date_idx ON app.activities USING btree (date);
CREATE INDEX "activities_userId_idx" ON app.activities USING btree ("userId");
CREATE INDEX document_audits_business_id_doc_type_doc_id_idx ON app.document_audits USING btree (business_id, doc_type, doc_id);
CREATE INDEX document_audits_business_id_created_at_idx ON app.document_audits USING btree (business_id, created_at);
CREATE INDEX listings_business_id_idx ON app.listings USING btree (business_id);
CREATE UNIQUE INDEX listings_product_id_key ON app.listings USING btree (product_id);
CREATE INDEX listings_active_idx ON app.listings USING btree (active);
CREATE INDEX listing_tiers_listing_id_idx ON app.listing_tiers USING btree (listing_id);
CREATE UNIQUE INDEX listing_tiers_listing_id_price_group_id_min_qty_key ON app.listing_tiers USING btree (listing_id, price_group_id, min_qty);
CREATE UNIQUE INDEX orders_seller_business_id_number_key ON app.orders USING btree (seller_business_id, number);
CREATE INDEX orders_seller_business_id_status_idx ON app.orders USING btree (seller_business_id, status);
CREATE INDEX orders_buyer_business_id_status_idx ON app.orders USING btree (buyer_business_id, status);
CREATE INDEX order_lines_order_id_idx ON app.order_lines USING btree (order_id);
CREATE INDEX webhooks_business_id_idx ON app.webhooks USING btree (business_id);
CREATE INDEX webhook_deliveries_status_next_at_idx ON app.webhook_deliveries USING btree (status, next_at);
CREATE INDEX api_keys_business_id_idx ON app.api_keys USING btree (business_id);
CREATE UNIQUE INDEX api_keys_prefix_key ON app.api_keys USING btree (prefix);
CREATE INDEX attendances_business_id_user_id_idx ON app.attendances USING btree (business_id, user_id);
CREATE INDEX attendances_business_id_check_in_idx ON app.attendances USING btree (business_id, check_in);
CREATE UNIQUE INDEX attendances_user_id_check_out_key ON app.attendances USING btree (user_id, check_out);
CREATE INDEX attendance_pauses_attendance_id_idx ON app.attendance_pauses USING btree (attendance_id);
CREATE INDEX bug_reports_business_id_idx ON app.bug_reports USING btree (business_id);

-- app_auth
CREATE UNIQUE INDEX users_email_business_id_key ON app_auth.users USING btree (email, business_id);
CREATE INDEX users_business_id_idx ON app_auth.users USING btree (business_id);
CREATE INDEX "sessions_userId_idx" ON app_auth.sessions USING btree ("userId");
CREATE INDEX "sessions_expiresAt_idx" ON app_auth.sessions USING btree ("expiresAt");
CREATE UNIQUE INDEX "security_policies_businessId_key" ON app_auth.security_policies USING btree ("businessId");
CREATE INDEX custom_roles_business_id_idx ON app_auth.custom_roles USING btree (business_id);
CREATE UNIQUE INDEX custom_roles_business_id_name_key ON app_auth.custom_roles USING btree (business_id, name);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FOREIGN KEYS
-- ═══════════════════════════════════════════════════════════════════════════════

-- app_auth → app (cross-schema)
ALTER TABLE ONLY app_auth.users ADD CONSTRAINT users_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.sessions ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.security_policies ADD CONSTRAINT "security_policies_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.custom_roles ADD CONSTRAINT custom_roles_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.role_capabilities ADD CONSTRAINT "role_capabilities_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES app_auth.custom_roles(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.role_customizations ADD CONSTRAINT role_customizations_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.user_overrides ADD CONSTRAINT "user_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.user_warehouses ADD CONSTRAINT "user_warehouses_userId_fkey" FOREIGN KEY ("userId") REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app_auth.user_warehouses ADD CONSTRAINT "user_warehouses_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES app.warehouses(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- app → app.businesses
ALTER TABLE ONLY app.categories ADD CONSTRAINT categories_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.suppliers ADD CONSTRAINT suppliers_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.warehouses ADD CONSTRAINT warehouses_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.price_groups ADD CONSTRAINT price_groups_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.customers ADD CONSTRAINT customers_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.customers ADD CONSTRAINT customers_buyer_business_id_fkey FOREIGN KEY (buyer_business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.customers ADD CONSTRAINT customers_price_group_id_fkey FOREIGN KEY (price_group_id) REFERENCES app.price_groups(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.products ADD CONSTRAINT products_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.products ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES app.categories(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.products ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES app.suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.stock_levels ADD CONSTRAINT "stock_levels_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.stock_levels ADD CONSTRAINT "stock_levels_productId_fkey" FOREIGN KEY ("productId") REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.stock_levels ADD CONSTRAINT "stock_levels_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES app.warehouses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.movements ADD CONSTRAINT movements_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.movements ADD CONSTRAINT "movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.movements ADD CONSTRAINT "movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES app.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.movements ADD CONSTRAINT "movements_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES app.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.movements ADD CONSTRAINT "movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.purchase_orders ADD CONSTRAINT purchase_orders_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.purchase_orders ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES app.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.purchase_orders ADD CONSTRAINT "purchase_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES app.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.purchase_order_lines ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES app.purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.purchase_order_lines ADD CONSTRAINT "purchase_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.po_sessions ADD CONSTRAINT po_sessions_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.po_tickets ADD CONSTRAINT po_tickets_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.po_tickets ADD CONSTRAINT "po_tickets_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.po_tickets ADD CONSTRAINT "po_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES app.customers(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.po_tickets ADD CONSTRAINT "po_tickets_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES app.po_sessions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.po_ticket_lines ADD CONSTRAINT "po_ticket_lines_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES app.po_tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.po_ticket_lines ADD CONSTRAINT "po_ticket_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.inventory_counts ADD CONSTRAINT inventory_counts_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.inventory_counts ADD CONSTRAINT "inventory_counts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES app.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.inventory_count_lines ADD CONSTRAINT "inventory_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES app.inventory_counts(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.inventory_count_lines ADD CONSTRAINT "inventory_count_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.invoices ADD CONSTRAINT invoices_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.invoices ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES app.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.invoices ADD CONSTRAINT invoices_issued_by_id_fkey FOREIGN KEY (issued_by_id) REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.invoice_lines ADD CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES app.invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.invoice_lines ADD CONSTRAINT invoice_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.estimates ADD CONSTRAINT estimates_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.estimates ADD CONSTRAINT estimates_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES app.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.estimates ADD CONSTRAINT estimates_issued_by_id_fkey FOREIGN KEY (issued_by_id) REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.estimate_lines ADD CONSTRAINT estimate_lines_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES app.estimates(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.estimate_lines ADD CONSTRAINT estimate_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.delivery_notes ADD CONSTRAINT delivery_notes_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.delivery_notes ADD CONSTRAINT delivery_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES app.customers(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.delivery_notes ADD CONSTRAINT delivery_notes_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES app.suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.delivery_notes ADD CONSTRAINT delivery_notes_issued_by_id_fkey FOREIGN KEY (issued_by_id) REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.delivery_notes ADD CONSTRAINT delivery_notes_return_of_id_fkey FOREIGN KEY (return_of_id) REFERENCES app.delivery_notes(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.delivery_note_lines ADD CONSTRAINT delivery_note_lines_delivery_note_id_fkey FOREIGN KEY (delivery_note_id) REFERENCES app.delivery_notes(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.delivery_note_lines ADD CONSTRAINT delivery_note_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.delivery_note_payments ADD CONSTRAINT delivery_note_payments_delivery_note_id_fkey FOREIGN KEY (delivery_note_id) REFERENCES app.delivery_notes(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.delivery_note_payments ADD CONSTRAINT delivery_note_payments_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.expense_category_defs ADD CONSTRAINT expense_category_defs_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.expenses ADD CONSTRAINT expenses_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.expenses ADD CONSTRAINT expenses_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES app.warehouses(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.expenses ADD CONSTRAINT expenses_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES app.suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.expenses ADD CONSTRAINT expenses_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.expense_photos ADD CONSTRAINT expense_photos_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES app.expenses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.notifications ADD CONSTRAINT notifications_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.activities ADD CONSTRAINT activities_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.activities ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.business_modules ADD CONSTRAINT business_modules_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.listings ADD CONSTRAINT listings_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.listings ADD CONSTRAINT listings_product_id_fkey FOREIGN KEY (product_id) REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.listing_tiers ADD CONSTRAINT listing_tiers_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES app.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.listing_tiers ADD CONSTRAINT listing_tiers_price_group_id_fkey FOREIGN KEY (price_group_id) REFERENCES app.price_groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.orders ADD CONSTRAINT orders_seller_business_id_fkey FOREIGN KEY (seller_business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.orders ADD CONSTRAINT orders_buyer_business_id_fkey FOREIGN KEY (buyer_business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES app.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.order_lines ADD CONSTRAINT order_lines_order_id_fkey FOREIGN KEY (order_id) REFERENCES app.orders(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.order_lines ADD CONSTRAINT order_lines_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES app.listings(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.order_lines ADD CONSTRAINT order_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES app.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY app.webhooks ADD CONSTRAINT webhooks_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.webhook_deliveries ADD CONSTRAINT webhook_deliveries_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES app.webhooks(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.api_keys ADD CONSTRAINT api_keys_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.attendances ADD CONSTRAINT attendances_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.attendances ADD CONSTRAINT attendances_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.attendance_pauses ADD CONSTRAINT attendance_pauses_attendance_id_fkey FOREIGN KEY (attendance_id) REFERENCES app.attendances(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.bug_reports ADD CONSTRAINT bug_reports_business_id_fkey FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.bug_reports ADD CONSTRAINT bug_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY app.warehouses ADD CONSTRAINT "warehouses_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES app_auth.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY app.delivery_note_payments ADD CONSTRAINT delivery_note_payments_business_id_stub FOREIGN KEY (business_id) REFERENCES app.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- GRANTS for tijaru_app role
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO tijaru_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_auth TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_auth TO tijaru_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tijaru_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tijaru_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tijaru_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth GRANT USAGE, SELECT ON SEQUENCES TO tijaru_app;

-- search_path so unqualified names resolve across schemas
ALTER ROLE tijaru_app SET search_path = app, app_auth, public;

COMMIT;
