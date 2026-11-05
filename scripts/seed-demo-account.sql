-- ============================================================================
-- Demo account seed for Apple App Store Review
-- Run: docker exec -i stock-postgres psql -U stock -d stock < scripts/seed-demo-account.sql
-- Remove after review approval.
-- ============================================================================

BEGIN;

-- ── IDs ──
DO $$
DECLARE
  v_biz_id     text := 'cdemo_biz_001';
  v_user_id    text := 'cdemo_usr_001';
  v_wh_id      text := 'cdemo_wh_001';
  v_cat1_id    text := 'cdemo_cat_001';
  v_cat2_id    text := 'cdemo_cat_002';
  v_cat3_id    text := 'cdemo_cat_003';
  v_cat4_id    text := 'cdemo_cat_004';
  v_sup1_id    text := 'cdemo_sup_001';
  v_sup2_id    text := 'cdemo_sup_002';
  -- products
  v_p1  text := 'cdemo_prod_001';
  v_p2  text := 'cdemo_prod_002';
  v_p3  text := 'cdemo_prod_003';
  v_p4  text := 'cdemo_prod_004';
  v_p5  text := 'cdemo_prod_005';
  v_p6  text := 'cdemo_prod_006';
  v_p7  text := 'cdemo_prod_007';
  v_p8  text := 'cdemo_prod_008';
  v_p9  text := 'cdemo_prod_009';
  v_p10 text := 'cdemo_prod_010';
  v_p11 text := 'cdemo_prod_011';
  v_p12 text := 'cdemo_prod_012';
  v_p13 text := 'cdemo_prod_013';
  v_p14 text := 'cdemo_prod_014';
  v_p15 text := 'cdemo_prod_015';
  -- customers
  v_c1  text := 'cdemo_cust_001';
  v_c2  text := 'cdemo_cust_002';
  v_c3  text := 'cdemo_cust_003';
  v_c4  text := 'cdemo_cust_004';
  v_c5  text := 'cdemo_cust_005';
  v_c6  text := 'cdemo_cust_006';
  v_c7  text := 'cdemo_cust_007';
  v_c8  text := 'cdemo_cust_008';
  -- customer categories
  v_cc1 text := 'cdemo_ccat_001';
  v_cc2 text := 'cdemo_ccat_002';
  -- delivery notes
  v_dn1 text := 'cdemo_dn_001';
  v_dn2 text := 'cdemo_dn_002';
  v_dn3 text := 'cdemo_dn_003';
  v_dn4 text := 'cdemo_dn_004';
  v_dn5 text := 'cdemo_dn_005';
  -- delivery note lines
  v_dl1 text := 'cdemo_dnl_001';
  v_dl2 text := 'cdemo_dnl_002';
  v_dl3 text := 'cdemo_dnl_003';
  v_dl4 text := 'cdemo_dnl_004';
  v_dl5 text := 'cdemo_dnl_005';
  v_dl6 text := 'cdemo_dnl_006';
  v_dl7 text := 'cdemo_dnl_007';
  v_dl8 text := 'cdemo_dnl_008';
  -- invoices
  v_inv1 text := 'cdemo_inv_001';
  v_inv2 text := 'cdemo_inv_002';
  v_inv3 text := 'cdemo_inv_003';
  -- invoice lines
  v_il1 text := 'cdemo_invl_001';
  v_il2 text := 'cdemo_invl_002';
  v_il3 text := 'cdemo_invl_003';
  v_il4 text := 'cdemo_invl_004';
  v_il5 text := 'cdemo_invl_005';
  v_il6 text := 'cdemo_invl_006';
  -- expenses
  v_exp1 text := 'cdemo_exp_001';
  v_exp2 text := 'cdemo_exp_002';
  v_exp3 text := 'cdemo_exp_003';
  v_exp4 text := 'cdemo_exp_004';
  v_exp5 text := 'cdemo_exp_005';
  -- expense category defs
  v_ecd1 text := 'cdemo_ecd_001';
  v_ecd2 text := 'cdemo_ecd_002';
  v_ecd3 text := 'cdemo_ecd_003';
  v_ecd4 text := 'cdemo_ecd_004';
  v_ecd5 text := 'cdemo_ecd_005';
  v_ecd6 text := 'cdemo_ecd_006';
  v_ecd7 text := 'cdemo_ecd_007';
  v_ecd8 text := 'cdemo_ecd_008';
  v_ecd9 text := 'cdemo_ecd_009';
  -- bcrypt hash of "soul.123" with cost 12
  v_pw_hash text := '$2b$12$ZVMR8JDoQk1vyreE8RDeaOhm.AMAYemle5OwjL0GLVldN4WO0kYmu';
  v_now timestamp := NOW();
BEGIN

  -- ══════════════════════════════════════════════════
  -- 1. Business (active, trial plan)
  -- ══════════════════════════════════════════════════
  INSERT INTO app.businesses (id, name, phone, city, address, status, plan, max_products, max_users, max_warehouses, "updatedAt")
  VALUES (v_biz_id, 'Épicerie Demo', '+212600000000', 'Casablanca', '123 Bd Mohammed V', 'active', 'trial', 100, 5, 2, v_now);

  -- ══════════════════════════════════════════════════
  -- 2. Owner user
  -- ══════════════════════════════════════════════════
  INSERT INTO app_auth.users (id, business_id, name, email, "passwordHash", role, phone, active, "updatedAt")
  VALUES (v_user_id, v_biz_id, 'Demo User', 'demo@tijaru.com', v_pw_hash, 'owner', '+212600000000', true, v_now);

  -- ══════════════════════════════════════════════════
  -- 3. Business modules (all enabled)
  -- ══════════════════════════════════════════════════
  INSERT INTO app.business_modules (business_id, module_id, active, "updatedAt") VALUES
    (v_biz_id, 'stock',           true, v_now),
    (v_biz_id, 'multi-stock',     true, v_now),
    (v_biz_id, 'pos',             true, v_now),
    (v_biz_id, 'expenses',        true, v_now),
    (v_biz_id, 'purchase-orders', true, v_now),
    (v_biz_id, 'inventory',       true, v_now),
    (v_biz_id, 'reports',         true, v_now),
    (v_biz_id, 'customers',       true, v_now),
    (v_biz_id, 'suppliers',       true, v_now);

  -- ══════════════════════════════════════════════════
  -- 4. Expense category definitions
  -- ══════════════════════════════════════════════════
  INSERT INTO app.expense_category_defs (id, business_id, key, label, tax_rate, sort_order, updated_at) VALUES
    (v_ecd1, v_biz_id, 'rent',        'Loyer',       20, 10, v_now),
    (v_ecd2, v_biz_id, 'utilities',   'Charges',     20, 20, v_now),
    (v_ecd3, v_biz_id, 'salaries',    'Salaires',     0, 30, v_now),
    (v_ecd4, v_biz_id, 'supplies',    'Fournitures', 20, 40, v_now),
    (v_ecd5, v_biz_id, 'transport',   'Transport',   14, 50, v_now),
    (v_ecd6, v_biz_id, 'maintenance', 'Entretien',   20, 60, v_now),
    (v_ecd7, v_biz_id, 'taxes',       'Taxes',        0, 70, v_now),
    (v_ecd8, v_biz_id, 'marketing',   'Marketing',   20, 80, v_now),
    (v_ecd9, v_biz_id, 'other',       'Autre',        0, 90, v_now);

  -- ══════════════════════════════════════════════════
  -- 5. Warehouse
  -- ══════════════════════════════════════════════════
  INSERT INTO app.warehouses (id, name, city, address, active, "isDefault", business_id, "updatedAt")
  VALUES (v_wh_id, 'Dépôt Principal', 'Casablanca', 'Zone Industrielle Aïn Sebaâ', true, true, v_biz_id, v_now);

  -- ══════════════════════════════════════════════════
  -- 6. Product categories
  -- ══════════════════════════════════════════════════
  INSERT INTO app.categories (id, name, icon, tone, business_id) VALUES
    (v_cat1_id, 'Boissons',      '🥤', '#3b82f6', v_biz_id),
    (v_cat2_id, 'Alimentaire',   '🍞', '#f59e0b', v_biz_id),
    (v_cat3_id, 'Hygiène',       '🧴', '#10b981', v_biz_id),
    (v_cat4_id, 'Fournitures',   '📦', '#8b5cf6', v_biz_id);

  -- ══════════════════════════════════════════════════
  -- 7. Suppliers
  -- ══════════════════════════════════════════════════
  INSERT INTO app.suppliers (id, name, contact, phone, city, business_id, "updatedAt") VALUES
    (v_sup1_id, 'Centrale Laitière',  'Ahmed Bennani',  '+212661000001', 'Casablanca', v_biz_id, v_now),
    (v_sup2_id, 'Brasseries du Maroc','Karim Fassi',    '+212661000002', 'Casablanca', v_biz_id, v_now);

  -- ══════════════════════════════════════════════════
  -- 8. Products (15 typical Moroccan épicerie items)
  -- ══════════════════════════════════════════════════
  INSERT INTO app.products (id, name, barcode, sku, "categoryId", purchase, sale, vat, unit, "supplierId", "minStock", business_id, "updatedAt") VALUES
    (v_p1,  'Lait Centrale 1L',       '6111245000011', 'LAI-001', v_cat1_id, 6.00,  7.50, 0,  'piece', v_sup1_id, 20, v_biz_id, v_now),
    (v_p2,  'Eau Sidi Ali 1.5L',      '6111245000028', 'EAU-001', v_cat1_id, 3.00,  4.00, 7,  'piece', NULL,      30, v_biz_id, v_now),
    (v_p3,  'Jus Valencia Orange 1L',  '6111245000035', 'JUS-001', v_cat1_id, 8.00, 12.00, 20, 'piece', NULL,      10, v_biz_id, v_now),
    (v_p4,  'Café Sahara 250g',        '6111245000042', 'CAF-001', v_cat2_id, 15.00, 22.00, 20, 'piece', NULL,      5,  v_biz_id, v_now),
    (v_p5,  'Thé Sultan 200g',         '6111245000059', 'THE-001', v_cat2_id, 12.00, 18.00, 20, 'piece', NULL,      10, v_biz_id, v_now),
    (v_p6,  'Sucre Pain 2kg',          '6111245000066', 'SUC-001', v_cat2_id, 14.00, 17.00, 0,  'piece', NULL,      15, v_biz_id, v_now),
    (v_p7,  'Huile Lesieur 1L',        '6111245000073', 'HUI-001', v_cat2_id, 16.00, 20.00, 10, 'litre', NULL,      8,  v_biz_id, v_now),
    (v_p8,  'Farine Fandy 1kg',        '6111245000080', 'FAR-001', v_cat2_id, 5.00,  7.00, 0,  'kg',    NULL,      10, v_biz_id, v_now),
    (v_p9,  'Savon Tide 3kg',          '6111245000097', 'SAV-001', v_cat3_id, 35.00, 45.00, 20, 'piece', NULL,      5,  v_biz_id, v_now),
    (v_p10, 'Dentifrice Signal',        '6111245000104', 'DEN-001', v_cat3_id, 12.00, 16.00, 20, 'piece', NULL,      8,  v_biz_id, v_now),
    (v_p11, 'Papier Hygiénique Okay',   '6111245000111', 'PAP-001', v_cat3_id, 8.00,  12.00, 20, 'piece', NULL,      10, v_biz_id, v_now),
    (v_p12, 'Sardines Titus 125g',      '6111245000128', 'SAR-001', v_cat2_id, 6.00,  9.00, 0,  'piece', NULL,      20, v_biz_id, v_now),
    (v_p13, 'Tomate Concentrée 400g',   '6111245000135', 'TOM-001', v_cat2_id, 5.50,  8.00, 0,  'piece', NULL,      15, v_biz_id, v_now),
    (v_p14, 'Stylos BIC x10',           '6111245000142', 'STY-001', v_cat4_id, 15.00, 20.00, 20, 'piece', NULL,      5,  v_biz_id, v_now),
    (v_p15, 'Cahier 96 pages',          '6111245000159', 'CAH-001', v_cat4_id, 5.00,  8.00, 20, 'piece', NULL,      10, v_biz_id, v_now);

  -- ══════════════════════════════════════════════════
  -- 9. Stock levels
  -- ══════════════════════════════════════════════════
  INSERT INTO app.stock_levels ("productId", "warehouseId", qty, "businessId", "updatedAt") VALUES
    (v_p1,  v_wh_id, 48,  v_biz_id, v_now),
    (v_p2,  v_wh_id, 72,  v_biz_id, v_now),
    (v_p3,  v_wh_id, 24,  v_biz_id, v_now),
    (v_p4,  v_wh_id, 18,  v_biz_id, v_now),
    (v_p5,  v_wh_id, 30,  v_biz_id, v_now),
    (v_p6,  v_wh_id, 40,  v_biz_id, v_now),
    (v_p7,  v_wh_id, 15,  v_biz_id, v_now),
    (v_p8,  v_wh_id, 25,  v_biz_id, v_now),
    (v_p9,  v_wh_id, 12,  v_biz_id, v_now),
    (v_p10, v_wh_id, 20,  v_biz_id, v_now),
    (v_p11, v_wh_id, 36,  v_biz_id, v_now),
    (v_p12, v_wh_id, 50,  v_biz_id, v_now),
    (v_p13, v_wh_id, 35,  v_biz_id, v_now),
    (v_p14, v_wh_id, 8,   v_biz_id, v_now),
    (v_p15, v_wh_id, 22,  v_biz_id, v_now);

  -- ══════════════════════════════════════════════════
  -- 10. Customer categories
  -- ══════════════════════════════════════════════════
  INSERT INTO app.customer_categories (id, business_id, label, color, credit_limit) VALUES
    (v_cc1, v_biz_id, 'Grossiste', '#3b82f6', 5000.00),
    (v_cc2, v_biz_id, 'Détaillant', '#f59e0b', 1000.00);

  -- ══════════════════════════════════════════════════
  -- 11. Customers
  -- ══════════════════════════════════════════════════
  INSERT INTO app.customers (id, name, phone, city, business_id, category_id, "updatedAt") VALUES
    (v_c1, 'Hassan El Idrissi',   '+212661100001', 'Casablanca',   v_biz_id, v_cc1, v_now),
    (v_c2, 'Fatima Zahra Amrani', '+212661100002', 'Rabat',        v_biz_id, v_cc2, v_now),
    (v_c3, 'Youssef Bennani',     '+212661100003', 'Marrakech',    v_biz_id, v_cc1, v_now),
    (v_c4, 'Aicha Tazi',          '+212661100004', 'Fès',          v_biz_id, v_cc2, v_now),
    (v_c5, 'Omar Chraibi',        '+212661100005', 'Tanger',       v_biz_id, NULL,  v_now),
    (v_c6, 'Khadija Senhaji',     '+212661100006', 'Agadir',       v_biz_id, NULL,  v_now),
    (v_c7, 'Mehdi Alaoui',        '+212661100007', 'Oujda',        v_biz_id, v_cc2, v_now),
    (v_c8, 'Nadia Filali',        '+212661100008', 'Meknès',       v_biz_id, NULL,  v_now);

  -- ══════════════════════════════════════════════════
  -- 12. Delivery notes (bons de livraison)
  -- ══════════════════════════════════════════════════
  INSERT INTO app.delivery_notes (id, business_id, number, type, date, status, customer_id, issued_by_id, signed, signed_at, "updatedAt") VALUES
    (v_dn1, v_biz_id, 'BL-2026-001', 'out', v_now - interval '10 days', 'delivered', v_c1, v_user_id, true,  v_now - interval '9 days',  v_now),
    (v_dn2, v_biz_id, 'BL-2026-002', 'out', v_now - interval '7 days',  'delivered', v_c2, v_user_id, true,  v_now - interval '6 days',  v_now),
    (v_dn3, v_biz_id, 'BL-2026-003', 'out', v_now - interval '5 days',  'sent',      v_c3, v_user_id, false, NULL,                       v_now),
    (v_dn4, v_biz_id, 'BL-2026-004', 'out', v_now - interval '3 days',  'prepared',  v_c4, v_user_id, false, NULL,                       v_now),
    (v_dn5, v_biz_id, 'BL-2026-005', 'out', v_now - interval '1 day',   'prepared',  v_c5, v_user_id, false, NULL,                       v_now);

  -- delivery note lines
  INSERT INTO app.delivery_note_lines (id, delivery_note_id, product_id, label, ordered, sent, unit_price, business_id) VALUES
    (v_dl1, v_dn1, v_p1,  'Lait Centrale 1L',      24, 24, 7.50,  v_biz_id),
    (v_dl2, v_dn1, v_p4,  'Café Sahara 250g',       5,  5, 22.00, v_biz_id),
    (v_dl3, v_dn2, v_p6,  'Sucre Pain 2kg',         10, 10, 17.00, v_biz_id),
    (v_dl4, v_dn2, v_p5,  'Thé Sultan 200g',         8,  8, 18.00, v_biz_id),
    (v_dl5, v_dn3, v_p2,  'Eau Sidi Ali 1.5L',      48,  0, 4.00,  v_biz_id),
    (v_dl6, v_dn3, v_p12, 'Sardines Titus 125g',    20,  0, 9.00,  v_biz_id),
    (v_dl7, v_dn4, v_p9,  'Savon Tide 3kg',          6,  0, 45.00, v_biz_id),
    (v_dl8, v_dn5, v_p7,  'Huile Lesieur 1L',       10,  0, 20.00, v_biz_id);

  -- ══════════════════════════════════════════════════
  -- 13. Invoices
  -- ══════════════════════════════════════════════════
  INSERT INTO app.invoices (id, business_id, number, date, due_date, customer_id, issued_by_id, status, ht, tva, total, paid, "updatedAt") VALUES
    (v_inv1, v_biz_id, 'FA-2026-001', v_now - interval '9 days', v_now + interval '21 days', v_c1, v_user_id, 'paid',    290.00, 22.00, 312.00, 312.00, v_now),
    (v_inv2, v_biz_id, 'FA-2026-002', v_now - interval '6 days', v_now + interval '24 days', v_c2, v_user_id, 'sent',    314.00, 28.80, 342.80,   0.00, v_now),
    (v_inv3, v_biz_id, 'FA-2026-003', v_now - interval '2 days', v_now + interval '28 days', v_c3, v_user_id, 'partial', 462.00, 67.44, 529.44, 200.00, v_now);

  -- invoice lines
  INSERT INTO app.invoice_lines (id, invoice_id, product_id, label, qty, price_ht, vat, business_id) VALUES
    (v_il1, v_inv1, v_p1, 'Lait Centrale 1L', 24, 7.50, 0,  v_biz_id),
    (v_il2, v_inv1, v_p4, 'Café Sahara 250g',  5, 22.00, 20, v_biz_id),
    (v_il3, v_inv2, v_p6, 'Sucre Pain 2kg',   10, 17.00, 0,  v_biz_id),
    (v_il4, v_inv2, v_p5, 'Thé Sultan 200g',   8, 18.00, 20, v_biz_id),
    (v_il5, v_inv3, v_p2, 'Eau Sidi Ali 1.5L', 48, 4.00, 7,  v_biz_id),
    (v_il6, v_inv3, v_p9, 'Savon Tide 3kg',     6, 45.00, 20, v_biz_id);

  -- ══════════════════════════════════════════════════
  -- 14. Expenses
  -- ══════════════════════════════════════════════════
  INSERT INTO app.expenses (id, business_id, date, amount, category, merchant_name, note, payment_method, created_by_id, updated_at) VALUES
    (v_exp1, v_biz_id, v_now - interval '15 days', 3500.00, 'rent',      'Propriétaire local',  'Loyer novembre 2026',    'cash',     v_user_id, v_now),
    (v_exp2, v_biz_id, v_now - interval '12 days',  850.00, 'utilities', 'LYDEC',               'Eau + électricité oct',  'card',     v_user_id, v_now),
    (v_exp3, v_biz_id, v_now - interval '8 days',   250.00, 'transport', 'Amana Express',       'Livraison Marrakech',    'cash',     v_user_id, v_now),
    (v_exp4, v_biz_id, v_now - interval '4 days',   120.00, 'supplies',  'Papeterie Atlas',     'Sacs plastiques + rouleaux', 'cash', v_user_id, v_now),
    (v_exp5, v_biz_id, v_now - interval '1 day',    180.00, 'maintenance','Plombier Mohammed',  'Réparation robinet',     'cash',     v_user_id, v_now);

  RAISE NOTICE 'Demo account seeded: demo@tijaru.com / soul.123';
END $$;

COMMIT;
