/** Numbered schema migrations. Applied in order inside a single transaction each. */

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
/* ------------------------------------------------------------------ */
/* Configuration & platform                                             */
/* ------------------------------------------------------------------ */
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE clinic_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  clinic_name TEXT NOT NULL DEFAULT '',
  logo_path TEXT,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  registration_info TEXT NOT NULL DEFAULT '',
  operating_hours TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT'),
  footer_note TEXT NOT NULL DEFAULT '',
  prescription_footer TEXT NOT NULL DEFAULT '',
  invoice_footer TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

/* ------------------------------------------------------------------ */
/* Security: users, roles, permissions                                  */
/* ------------------------------------------------------------------ */
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

/* ------------------------------------------------------------------ */
/* People                                                               */
/* ------------------------------------------------------------------ */
CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  dob TEXT,
  gender TEXT CHECK (gender IN ('male','female','other')),
  blood_group TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  section TEXT NOT NULL DEFAULT '',
  salary_poisha INTEGER NOT NULL DEFAULT 0,
  joining_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dentists (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dentist_designations (
  id INTEGER PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
  designation TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_dentist_designations_dentist ON dentist_designations(dentist_id, sort_order);

CREATE TABLE dentist_qualifications (
  id INTEGER PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
  qualification TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_dentist_qualifications_dentist ON dentist_qualifications(dentist_id, sort_order);

/* ------------------------------------------------------------------ */
/* Patients                                                             */
/* ------------------------------------------------------------------ */
CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  patient_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('male','female','other')),
  dob TEXT,
  age_years INTEGER,
  blood_group TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  emergency_phone TEXT NOT NULL DEFAULT '',
  emergency_contact TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  presenting_problem TEXT NOT NULL DEFAULT '',
  previous_history TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '',
  medical_history TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  preferred_language TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  registered_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_patients_name ON patients(full_name);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_registered ON patients(registered_at DESC);
CREATE INDEX idx_patients_status ON patients(status);

CREATE TABLE patient_alerts (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('allergy','condition','other')),
  message TEXT NOT NULL
);
CREATE INDEX idx_patient_alerts_patient ON patient_alerts(patient_id);

/* ------------------------------------------------------------------ */
/* Clinical reference data                                              */
/* ------------------------------------------------------------------ */
CREATE TABLE teeth (
  fdi TEXT PRIMARY KEY,
  dentition TEXT NOT NULL CHECK (dentition IN ('permanent','primary')),
  quadrant INTEGER NOT NULL,
  position INTEGER NOT NULL,
  universal TEXT NOT NULL,
  palmer TEXT NOT NULL,
  label TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('incisor','canine','premolar','molar'))
);

CREATE TABLE tooth_conditions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dental_chart_entries (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  fdi TEXT NOT NULL REFERENCES teeth(fdi) ON DELETE RESTRICT,
  condition_code TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('mild','moderate','severe')),
  notes TEXT NOT NULL DEFAULT '',
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at INTEGER NOT NULL,
  UNIQUE (patient_id, fdi, condition_code)
);
CREATE INDEX idx_chart_patient ON dental_chart_entries(patient_id);

CREATE TABLE clinical_options (
  id INTEGER PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('cc','oe','re')),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 1,
  UNIQUE (section, code)
);

CREATE TABLE treatments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  default_price_poisha INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_treatments_name ON treatments(name);
CREATE INDEX idx_treatments_category ON treatments(category);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  visit_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  visited_at INTEGER NOT NULL,
  chief_complaint TEXT NOT NULL DEFAULT '',
  examination TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  treatment_performed TEXT NOT NULL DEFAULT '',
  treatment_plan TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  follow_up_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_visits_patient ON visits(patient_id, visited_at DESC);
CREATE INDEX idx_visits_dentist ON visits(dentist_id, visited_at DESC);

CREATE TABLE visit_clinical_options (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  option_code TEXT NOT NULL,
  label TEXT NOT NULL,
  UNIQUE (visit_id, option_code)
);

CREATE TABLE visit_treatments (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE referrals (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  referred_to TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  referred_on TEXT NOT NULL,
  follow_up_on TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_referrals_patient ON referrals(patient_id);

/* ------------------------------------------------------------------ */
/* Appointments & queue                                                 */
/* ------------------------------------------------------------------ */
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  appointment_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','checked_in','in_progress','completed','no_show','cancelled')),
  checked_in_at INTEGER,
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_appt_dentist_time ON appointments(dentist_id, starts_at);
CREATE INDEX idx_appt_patient ON appointments(patient_id, starts_at DESC);
CREATE INDEX idx_appt_status ON appointments(status, starts_at);

CREATE TABLE queue_entries (
  id INTEGER PRIMARY KEY,
  queue_date TEXT NOT NULL,
  position INTEGER NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  walk_in INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','in_progress','completed','skipped')),
  checked_in_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_queue_unique_active ON queue_entries(queue_date, patient_id, dentist_id)
  WHERE status IN ('waiting','in_progress');
CREATE INDEX idx_queue_date ON queue_entries(queue_date, status, position);

/* ------------------------------------------------------------------ */
/* Prescriptions                                                        */
/* ------------------------------------------------------------------ */
CREATE TABLE medicine_catalog (
  id INTEGER PRIMARY KEY,
  medicine_name TEXT NOT NULL,
  form TEXT NOT NULL DEFAULT '',
  strength TEXT NOT NULL DEFAULT '',
  default_instructions TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_medicine_name ON medicine_catalog(medicine_name);

CREATE TABLE prescriptions (
  id INTEGER PRIMARY KEY,
  prescription_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  issued_at INTEGER NOT NULL,
  chief_complaint TEXT NOT NULL DEFAULT '',
  on_examination TEXT NOT NULL DEFAULT '',
  rest_examination TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rx_patient ON prescriptions(patient_id, issued_at DESC);
CREATE INDEX idx_rx_dentist ON prescriptions(dentist_id, issued_at DESC);

CREATE TABLE prescription_items (
  id INTEGER PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  medicine_name TEXT NOT NULL,
  form TEXT NOT NULL DEFAULT '',
  strength TEXT NOT NULL DEFAULT '',
  dose TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT '',
  timing TEXT NOT NULL DEFAULT '',
  before_after_food TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  quantity TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_rx_items_rx ON prescription_items(prescription_id, seq);

/* ------------------------------------------------------------------ */
/* Billing                                                              */
/* ------------------------------------------------------------------ */
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  invoice_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  invoice_date TEXT NOT NULL,
  subtotal_poisha INTEGER NOT NULL DEFAULT 0,
  discount_poisha INTEGER NOT NULL DEFAULT 0,
  adjustment_poisha INTEGER NOT NULL DEFAULT 0,
  total_poisha INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','void')),
  notes TEXT NOT NULL DEFAULT '',
  void_reason TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_invoices_patient ON invoices(patient_id, created_at DESC);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_poisha INTEGER NOT NULL,
  discount_poisha INTEGER NOT NULL DEFAULT 0,
  total_poisha INTEGER NOT NULL
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id, seq);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  payment_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_poisha INTEGER NOT NULL CHECK (amount_poisha > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card','bkash','nagad','rocket','upay','other')),
  reference TEXT NOT NULL DEFAULT '',
  paid_at INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_voided INTEGER NOT NULL DEFAULT 0,
  void_reason TEXT NOT NULL DEFAULT '',
  voided_at INTEGER,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_paid_at ON payments(paid_at DESC);
CREATE INDEX idx_payments_patient ON payments(patient_id, paid_at DESC);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

/* ------------------------------------------------------------------ */
/* Inventory                                                            */
/* ------------------------------------------------------------------ */
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price_poisha INTEGER NOT NULL DEFAULT 0,
  sale_price_poisha INTEGER NOT NULL DEFAULT 0,
  opening_stock INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0,
  used_qty INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  batch_number TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_inventory_name ON inventory_items(name);

CREATE TABLE inventory_transactions (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('opening','purchase','usage','adjustment','wastage','return')),
  quantity INTEGER NOT NULL,
  unit_price_poisha INTEGER,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_inv_txn_item ON inventory_transactions(item_id, created_at DESC);

/* ------------------------------------------------------------------ */
/* Accounting                                                           */
/* ------------------------------------------------------------------ */
CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount_poisha INTEGER NOT NULL CHECK (amount_poisha > 0),
  spent_on TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card','bkash','nagad','rocket','upay','other')),
  description TEXT NOT NULL DEFAULT '',
  entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(spent_on);

CREATE TABLE other_income (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  amount_poisha INTEGER NOT NULL CHECK (amount_poisha > 0),
  received_on TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card','bkash','nagad','rocket','upay','other')),
  notes TEXT NOT NULL DEFAULT '',
  entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_other_income_date ON other_income(received_on);

/* ------------------------------------------------------------------ */
/* Platform                                                             */
/* ------------------------------------------------------------------ */
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);
CREATE INDEX idx_attachments_patient ON attachments(patient_id);

CREATE TABLE printer_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('prescription','invoice')),
  printer_name TEXT,
  paper_size TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4','A5','A6','Letter','thermal58','thermal80')),
  orientation TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape')),
  margin_top_mm REAL NOT NULL DEFAULT 12,
  margin_bottom_mm REAL NOT NULL DEFAULT 12,
  margin_left_mm REAL NOT NULL DEFAULT 12,
  margin_right_mm REAL NOT NULL DEFAULT 12,
  scale_percent INTEGER NOT NULL DEFAULT 100,
  copies INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE backup_records (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('manual','auto','pre_restore')),
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_backup_created ON backup_records(created_at DESC);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('appointment','inventory','financial','backup','system')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  permission TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(is_read, created_at DESC);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id INTEGER,
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '',
  after_json TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_at ON audit_logs(at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    id: 2,
    name: 'session_lock_policy',
    sql: `
/* Persisted auto-lock / notification preferences (defaults applied by seed). */
INSERT INTO settings (key, value, updated_at) VALUES
  ('autoLockMinutes', '15', strftime('%s','now') * 1000),
  ('backupIntervalDays', '0', strftime('%s','now') * 1000),
  ('defaultPaperSize', 'A4', strftime('%s','now') * 1000),
  ('notifyAppointments', '1', strftime('%s','now') * 1000),
  ('notifyInventory', '1', strftime('%s','now') * 1000),
  ('notifyFinancial', '1', strftime('%s','now') * 1000),
  ('notifyBackup', '1', strftime('%s','now') * 1000)
  ON CONFLICT(key) DO NOTHING;
`,
  },
];
