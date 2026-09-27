INSERT INTO permission (key, description) VALUES
  ('clinic.configure',       'Manage practitioners, schedules, rooms, visit types, coding systems and closures'),
  ('appointment.read',       'View appointments, schedules and availability'),
  ('appointment.manage',     'Book, confirm, reschedule, cancel appointments and manage the waitlist'),
  ('clinic.queue.read',      'View the facility queue'),
  ('clinic.queue.manage',    'Check patients in and move them through the queue'),
  ('clinic.triage.write',    'Record triage assessments and vital signs'),
  ('clinical.read',          'View clinical summaries: allergies, vital signs, problem list'),
  ('allergy.manage',         'Record and update allergies and allergy reviews'),
  ('encounter.read',         'View encounters, notes and diagnoses'),
  ('encounter.write',        'Start encounters, write notes, record diagnoses'),
  ('encounter.sign',         'Sign (complete) encounters'),
  ('encounter.amend',        'Amend signed encounters'),
  ('prescription.read',      'View prescriptions'),
  ('prescription.issue',     'Issue and replace prescriptions'),
  ('prescription.cancel',    'Cancel prescriptions'),
  ('care-plan.read',         'View care plans and due follow-ups'),
  ('care-plan.manage',       'Create and update care plans, goals and activities'),
  ('clinic.dashboard.read',  'View the clinic dashboard');

-- Organization administrators hold every permission.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('physician', 'appointment.read'), ('physician', 'appointment.manage'), ('physician', 'clinic.queue.read'),
  ('physician', 'clinic.queue.manage'), ('physician', 'clinic.triage.write'), ('physician', 'clinical.read'),
  ('physician', 'allergy.manage'), ('physician', 'encounter.read'), ('physician', 'encounter.write'),
  ('physician', 'encounter.sign'), ('physician', 'encounter.amend'), ('physician', 'prescription.read'),
  ('physician', 'prescription.issue'), ('physician', 'prescription.cancel'), ('physician', 'care-plan.read'),
  ('physician', 'care-plan.manage'), ('physician', 'clinic.dashboard.read'),
  ('nurse', 'appointment.read'), ('nurse', 'clinic.queue.read'), ('nurse', 'clinic.queue.manage'),
  ('nurse', 'clinic.triage.write'), ('nurse', 'clinical.read'), ('nurse', 'allergy.manage'),
  ('nurse', 'encounter.read'), ('nurse', 'prescription.read'), ('nurse', 'care-plan.read'),
  ('nurse', 'care-plan.manage'), ('nurse', 'clinic.dashboard.read'),
  ('receptionist', 'appointment.read'), ('receptionist', 'appointment.manage'), ('receptionist', 'clinic.queue.read'),
  ('receptionist', 'clinic.queue.manage'), ('receptionist', 'clinic.dashboard.read'),
  ('records_officer', 'appointment.read'), ('records_officer', 'clinical.read'), ('records_officer', 'encounter.read'),
  ('records_officer', 'prescription.read'), ('records_officer', 'care-plan.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system;
