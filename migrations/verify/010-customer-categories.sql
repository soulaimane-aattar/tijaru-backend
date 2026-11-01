-- Verify 010-customer-categories
SELECT id, business_id, label, color, credit_limit FROM app.customer_categories WHERE FALSE;
SELECT category_id FROM app.customers WHERE FALSE;
