/** Reference-data seeds: permissions, roles, teeth, conditions, clinical options, defaults. */

import type { DB } from './database';
import { BUILT_IN_ROLES, PERMISSIONS } from '@shared/permissions';
import type { ToothDef, ToothConditionDef } from '@shared/types';

export function buildTeeth(): ToothDef[] {
  const out: ToothDef[] = [];
  const permanentUniversal = [
    '1', '2', '3', '4', '5', '6', '7', '8', // Q1 (11-18) — universal 1-8
    '9', '10', '11', '12', '13', '14', '15', '16', // Q2 (21-28) — universal 9-16
    '32', '31', '30', '29', '28', '27', '26', '25', // Q3 (31-38) — universal 32..25
    '24', '23', '22', '21', '20', '19', '18', '17', // Q4 (41-48) — universal 24..17
  ];
  const regionFor = (pos: number): ToothDef['region'] =>
    pos === 1 || pos === 2 ? 'incisor' : pos === 3 ? 'canine' : pos <= 5 ? 'premolar' : 'molar';

  let idx = 0;
  for (const quadrant of [1, 2, 3, 4]) {
    for (let position = 1; position <= 8; position++) {
      const fdi = `${quadrant}${position}`;
      out.push({
        fdi,
        dentition: 'permanent',
        quadrant,
        position,
        universal: permanentUniversal[idx] as string,
        palmer: `${quadrant}\\${position}`,
        label: `Tooth ${fdi}`,
        region: regionFor(position),
      });
      idx++;
    }
  }
  // Primary teeth: FDI quadrants 5-8, universal letters A-T.
  const primaryLetters = 'ABCDEFGHIJT';
  // Universal numbering for primary: A-E upper right (51-55), F-J upper left (61-65),
  // K-O lower left (71-75), P-T lower right (81-85). FDI primary order 5,6,7,8.
  const primaryUniversalByQuadrant: Record<number, string[]> = {
    5: ['A', 'B', 'C', 'D', 'E'],
    6: ['F', 'G', 'H', 'I', 'J'],
    7: ['K', 'L', 'M', 'N', 'O'],
    8: ['P', 'Q', 'R', 'S', 'T'],
  };
  void primaryLetters;
  for (const quadrant of [5, 6, 7, 8]) {
    const letters = primaryUniversalByQuadrant[quadrant] as string[];
    for (let position = 1; position <= 5; position++) {
      const fdi = `${quadrant}${position}`;
      out.push({
        fdi,
        dentition: 'primary',
        quadrant,
        position,
        universal: letters[position - 1] as string,
        palmer: `${quadrant}\\${position}`,
        label: `Tooth ${fdi} (primary)`,
        region: position <= 2 ? 'incisor' : position === 3 ? 'canine' : 'molar',
      });
    }
  }
  return out;
}

export const TOOTH_CONDITIONS: Omit<ToothConditionDef, 'id' | 'isCustom'>[] = [
  { code: 'caries', label: 'Caries', category: 'Disease', color: '#e11d48' },
  { code: 'arrested_caries', label: 'Arrested caries', category: 'Disease', color: '#f43f5e' },
  { code: 'missing', label: 'Missing tooth', category: 'Status', color: '#64748b' },
  { code: 'impacted', label: 'Impacted', category: 'Status', color: '#7c3aed' },
  { code: 'partially_erupted', label: 'Partially erupted', category: 'Status', color: '#8b5cf6' },
  { code: 'supernumerary', label: 'Supernumerary', category: 'Status', color: '#a855f7' },
  { code: 'mobility_1', label: 'Mobility grade I', category: 'Periodontal', color: '#f59e0b' },
  { code: 'mobility_2', label: 'Mobility grade II', category: 'Periodontal', color: '#f97316' },
  { code: 'mobility_3', label: 'Mobility grade III', category: 'Periodontal', color: '#ea580c' },
  { code: 'gingivitis', label: 'Gingivitis', category: 'Periodontal', color: '#fb923c' },
  { code: 'periodontal_pocket', label: 'Periodontal pocket', category: 'Periodontal', color: '#d97706' },
  { code: 'periodontitis', label: 'Periodontitis', category: 'Periodontal', color: '#b45309' },
  { code: 'recession', label: 'Gum recession', category: 'Periodontal', color: '#ca8a04' },
  { code: 'abscess', label: 'Abscess', category: 'Infection', color: '#be123c' },
  { code: 'sinus_tract', label: 'Sinus tract', category: 'Infection', color: '#9f1239' },
  { code: 'sensitivity', label: 'Sensitivity', category: 'Symptom', color: '#0ea5e9' },
  { code: 'fracture', label: 'Fracture', category: 'Structural', color: '#dc2626' },
  { code: 'cracked', label: 'Cracked tooth', category: 'Structural', color: '#ef4444' },
  { code: 'attrition', label: 'Attrition', category: 'Structural', color: '#0891b2' },
  { code: 'erosion', label: 'Erosion', category: 'Structural', color: '#06b6d4' },
  { code: 'abrasion', label: 'Abrasion', category: 'Structural', color: '#14b8a6' },
  { code: 'abfraction', label: 'Abfraction', category: 'Structural', color: '#10b981' },
  { code: 'hypoplasia', label: 'Enamel hypoplasia', category: 'Structural', color: '#65a30d' },
  { code: 'discoloration', label: 'Discoloration', category: 'Structural', color: '#a3e635' },
  { code: 'restoration_existing', label: 'Existing restoration', category: 'Restoration', color: '#2563eb' },
  { code: 'restoration_defective', label: 'Defective restoration', category: 'Restoration', color: '#1d4ed8' },
  { code: 'sealant', label: 'Sealant placed', category: 'Restoration', color: '#3b82f6' },
  { code: 'composite', label: 'Composite filling', category: 'Restoration', color: '#60a5fa' },
  { code: 'amalgam', label: 'Amalgam filling', category: 'Restoration', color: '#475569' },
  { code: 'crown', label: 'Crown', category: 'Prosthetic', color: '#7c3aed' },
  { code: 'bridge_abutment', label: 'Bridge abutment', category: 'Prosthetic', color: '#6d28d9' },
  { code: 'bridge_pontic', label: 'Bridge pontic', category: 'Prosthetic', color: '#5b21b6' },
  { code: 'implant', label: 'Implant', category: 'Prosthetic', color: '#4338ca' },
  { code: 'denture', label: 'Denture', category: 'Prosthetic', color: '#4f46e5' },
  { code: 'root_canal', label: 'Root canal treated', category: 'Endodontic', color: '#0d9488' },
  { code: 'root_canal_need', label: 'Root canal needed', category: 'Endodontic', color: '#14b8a6' },
  { code: 'periapical_lesion', label: 'Periapical lesion', category: 'Endodontic', color: '#0f766e' },
  { code: 'extraction_needed', label: 'Extraction needed', category: 'Treatment planning', color: '#e11d48' },
  { code: 'ortho_band', label: 'Orthodontic band', category: 'Orthodontic', color: '#9333ea' },
  { code: 'ortho_bracket', label: 'Orthodontic bracket', category: 'Orthodontic', color: '#a21caf' },
  { code: 'space_maintainer', label: 'Space maintainer', category: 'Orthodontic', color: '#c026d3' },
  { code: 'unerupted', label: 'Unerupted', category: 'Status', color: '#a78bfa' },
];

export const CLINICAL_OPTIONS: { section: 'cc' | 'oe' | 're'; code: string; label: string }[] = [
  // Chief complaints
  { section: 'cc', code: 'cc_pain', label: 'Pain' },
  { section: 'cc', code: 'cc_pain_hot_cold', label: 'Pain on hot / cold' },
  { section: 'cc', code: 'cc_pain_spontaneous', label: 'Spontaneous pain' },
  { section: 'cc', code: 'cc_pain_bite', label: 'Pain on biting' },
  { section: 'cc', code: 'cc_sensitivity', label: 'Sensitivity' },
  { section: 'cc', code: 'cc_swelling', label: 'Swelling' },
  { section: 'cc', code: 'cc_bleeding_gums', label: 'Bleeding gums' },
  { section: 'cc', code: 'cc_shaking_tooth', label: 'Shaking tooth' },
  { section: 'cc', code: 'cc_bad_breath', label: 'Bad breath (halitosis)' },
  { section: 'cc', code: 'cc_generalized_caries', label: 'Generalized caries' },
  { section: 'cc', code: 'cc_localized_caries', label: 'Localized caries' },
  { section: 'cc', code: 'cc_broken_tooth', label: 'Broken / fractured tooth' },
  { section: 'cc', code: 'cc_missing_tooth', label: 'Missing tooth' },
  { section: 'cc', code: 'cc_mobile_tooth', label: 'Mobile tooth' },
  { section: 'cc', code: 'cc_food_impaction', label: 'Food impaction' },
  { section: 'cc', code: 'cc_jaw_pain', label: 'Jaw pain' },
  { section: 'cc', code: 'cc_opening_difficulty', label: 'Difficulty opening mouth' },
  { section: 'cc', code: 'cc_ulcer', label: 'Mouth ulcer' },
  { section: 'cc', code: 'cc_discharge', label: 'Pus discharge' },
  { section: 'cc', code: 'cc_wisdom_tooth', label: 'Wisdom tooth complaint' },
  { section: 'cc', code: 'cc_cosmetic', label: 'Cosmetic concern' },
  { section: 'cc', code: 'cc_checkup', label: 'Routine check-up' },
  { section: 'cc', code: 'cc_braces', label: 'Orthodontic consultation' },
  { section: 'cc', code: 'cc_child_tooth', label: 'Child tooth problem' },

  // On examination
  { section: 'oe', code: 'oe_deep_cavity', label: 'Deep carious cavity' },
  { section: 'oe', code: 'oe_cervical_caries', label: 'Cervical caries' },
  { section: 'oe', code: 'oe_interproximal_caries', label: 'Interproximal caries' },
  { section: 'oe', code: 'oe_pulp_exposure', label: 'Pulp exposure' },
  { section: 'oe', code: 'oe_swelling_around_tooth', label: 'Swelling around tooth' },
  { section: 'oe', code: 'oe_sinus_tract', label: 'Sinus tract present' },
  { section: 'oe', code: 'oe_gingival_bleeding', label: 'Gingival bleeding on probing' },
  { section: 'oe', code: 'oe_calculus', label: 'Calculus deposit' },
  { section: 'oe', code: 'oe_pocket_4mm', label: 'Pocket 4 mm' },
  { section: 'oe', code: 'oe_pocket_5mm_plus', label: 'Pocket ≥5 mm' },
  { section: 'oe', code: 'oe_recession', label: 'Gingival recession' },
  { section: 'oe', code: 'oe_tooth_discolored', label: 'Tooth discoloration' },
  { section: 'oe', code: 'oe_mobilized', label: 'Tooth mobility present' },
  { section: 'oe', code: 'oe_fractured_crown', label: 'Fractured crown' },
  { section: 'oe', code: 'oe_wear_facets', label: 'Wear facets / attrition' },
  { section: 'oe', code: 'oe_erosion', label: 'Erosion present' },
  { section: 'oe', code: 'oe_orthodontic_alignment', label: 'Malocclusion noted' },
  { section: 'oe', code: 'oe_partial_eruption', label: 'Partial eruption' },
  { section: 'oe', code: 'oe_over_retained', label: 'Over-retained tooth' },
  { section: 'oe', code: 'oe_drifting', label: 'Drifting tooth' },
  { section: 'oe', code: 'oe_tenderness', label: 'Tenderness on palpation' },
  { section: 'oe', code: 'oe_trismus', label: 'Trismus (limited opening)' },
  { section: 'oe', code: 'oe_lesion', label: 'Localized lesion' },
  { section: 'oe', code: 'oe_negative_vitality', label: 'Non-vital tooth' },

  // Rest / extra findings (R/E used as findings & advice section)
  { section: 're', code: 're_chronic_periodontitis', label: 'Chronic periodontitis' },
  { section: 're', code: 're_aggressive_periodontitis', label: 'Aggressive periodontitis' },
  { section: 're', code: 're_apical_periodontitis', label: 'Apical periodontitis' },
  { section: 're', code: 're_acute_pulpitis', label: 'Acute pulpitis' },
  { section: 're', code: 're_chronic_pulpitis', label: 'Chronic pulpitis' },
  { section: 're', code: 're_necrosis', label: 'Pulp necrosis' },
  { section: 're', code: 're_dry_socket', label: 'Dry socket (alveolitis)' },
  { section: 're', code: 're_pericoronitis', label: 'Pericoronitis' },
  { section: 're', code: 're_dental_caries_icdAS', label: 'Dental caries' },
  { section: 're', code: 're_missing_congenital', label: 'Congenitally missing tooth' },
  { section: 're', code: 're_impacted_III', label: 'Impacted tooth (classified)' },
  { section: 're', code: 're_crown_fracture_ellis', label: 'Crown fracture (Ellis I)' },
  { section: 're', code: 're_root_fracture', label: 'Root fracture' },
  { section: 're', code: 're_malocclusion_ii', label: 'Class II malocclusion' },
  { section: 're', code: 're_malocclusion_iii', label: 'Class III malocclusion' },
  { section: 're', code: 're_open_bite', label: 'Open bite' },
  { section: 're', code: 're_crossbite', label: 'Crossbite' },
  { section: 're', code: 're_diastema', label: 'Diastema' },
  { section: 're', code: 're_overeruption', label: 'Over-erupted tooth' },
  { section: 're', code: 're_toothwear', label: 'Tooth wear' },
  { section: 're', code: 're_implant_candidate', label: 'Implant candidate' },
  { section: 're', code: 're_endo_retx', label: 'Endodontic retreatment indicated' },
  { section: 're', code: 're_extraction_indicated', label: 'Extraction indicated' },
  { section: 're', code: 're_urgent_care', label: 'Requires urgent care' },
];

export const BUILT_IN_EXPENSE_CATEGORIES = [
  'Clinic Rent',
  'Electricity',
  'Internet',
  'Supplies & Accessories',
  'Staff Salaries',
  'Maintenance',
  'Transport',
  'Utilities',
  'Miscellaneous Expenses',
];

export const DEFAULT_TREATMENTS: {
  code: string;
  name: string;
  category: string;
  priceBdt: number;
  duration: number;
  description: string;
}[] = [
  { code: 'CONS', name: 'Consultation', category: 'General', priceBdt: 300, duration: 15, description: 'Initial examination and treatment planning' },
  { code: 'SCALING', name: 'Scaling & Polishing', category: 'Preventive', priceBdt: 1500, duration: 45, description: 'Full-mouth ultrasonic scaling with polishing' },
  { code: 'FILLING-CC', name: 'Composite Filling (1 surface)', category: 'Restorative', priceBdt: 1500, duration: 30, description: 'Light-cured composite restoration, one surface' },
  { code: 'FILLING-2C', name: 'Composite Filling (2+ surfaces)', category: 'Restorative', priceBdt: 2200, duration: 45, description: 'Light-cured composite restoration, multi-surface' },
  { code: 'AMALGAM', name: 'Amalgam Filling', category: 'Restorative', priceBdt: 1200, duration: 30, description: 'Silver amalgam restoration' },
  { code: 'PULPOTOMY', name: 'Pulpotomy', category: 'Endodontic', priceBdt: 2000, duration: 45, description: 'Vital pulp therapy for primary/young permanent teeth' },
  { code: 'RCT-ANT', name: 'Root Canal Treatment — Anterior', category: 'Endodontic', priceBdt: 5000, duration: 60, description: 'Single-visit RCT, incisors/canines' },
  { code: 'RCT-PREM', name: 'Root Canal Treatment — Premolar', category: 'Endodontic', priceBdt: 6500, duration: 75, description: 'RCT, premolars' },
  { code: 'RCT-MOLAR', name: 'Root Canal Treatment — Molar', category: 'Endodontic', priceBdt: 8000, duration: 90, description: 'RCT, molars' },
  { code: 'EXT-SIMPLE', name: 'Simple Extraction', category: 'Oral Surgery', priceBdt: 1500, duration: 30, description: 'Non-surgical tooth extraction' },
  { code: 'EXT-SURG', name: 'Surgical Extraction', category: 'Oral Surgery', priceBdt: 3500, duration: 60, description: 'Surgical removal including sectioning' },
  { code: 'EXT-IMPACTED', name: 'Impacted Tooth Removal', category: 'Oral Surgery', priceBdt: 6000, duration: 60, description: 'Wisdom tooth / impacted tooth surgery' },
  { code: 'CROWN-MMC', name: 'Metal-Ceramic Crown', category: 'Prosthodontic', priceBdt: 9000, duration: 60, description: 'PFM crown including try-in and cementation' },
  { code: 'CROWN-ZRC', name: 'Zirconia Crown', category: 'Prosthodontic', priceBdt: 14000, duration: 60, description: 'Full-contour zirconia crown' },
  { code: 'BRIDGE-3U', name: '3-Unit Bridge', category: 'Prosthodontic', priceBdt: 24000, duration: 90, description: 'Fixed bridge, three units' },
  { code: 'DENTURE-CD', name: 'Complete Denture (per arch)', category: 'Prosthodontic', priceBdt: 15000, duration: 120, description: 'Full denture, all appointments included' },
  { code: 'DENTURE-PD', name: 'Partial Denture', category: 'Prosthodontic', priceBdt: 8000, duration: 90, description: 'Removable partial denture' },
  { code: 'IMPLANT', name: 'Dental Implant (fixture only)', category: 'Implantology', priceBdt: 45000, duration: 90, description: 'Implant fixture placement, abutment/crown separate' },
  { code: 'FLUORIDE', name: 'Topical Fluoride Application', category: 'Preventive', priceBdt: 800, duration: 15, description: 'Professional fluoride varnish' },
  { code: 'SEALANT', name: 'Pit & Fissure Sealant', category: 'Preventive', priceBdt: 700, duration: 15, description: 'Per tooth' },
  { code: 'WHITENING', name: 'Teeth Whitening (in-office)', category: 'Cosmetic', priceBdt: 12000, duration: 60, description: 'Chairside bleaching session' },
  { code: 'VENEER', name: 'Porcelain Veneer', category: 'Cosmetic', priceBdt: 15000, duration: 60, description: 'Per tooth, laboratory fabricated' },
  { code: 'ORTHO-CONS', name: 'Orthodontic Consultation', category: 'Orthodontic', priceBdt: 500, duration: 20, description: 'Records and treatment plan discussion' },
  { code: 'ORTHO-METAL', name: 'Braces — Metal (per month)', category: 'Orthodontic', priceBdt: 5000, duration: 30, description: 'Monthly adjustment, conventional metal braces' },
  { code: 'ORTHO-CER', name: 'Braces — Ceramic (per month)', category: 'Orthodontic', priceBdt: 7000, duration: 30, description: 'Monthly adjustment, tooth-coloured braces' },
  { code: 'ROOT-CURETTE', name: 'Root Planing (per quadrant)', category: 'Periodontic', priceBdt: 3000, duration: 45, description: 'Deep scaling under local anaesthesia' },
  { code: 'GINGIVECTOMY', name: 'Gingivectomy', category: 'Periodontic', priceBdt: 4000, duration: 60, description: 'Surgical gum reshaping per quadrant' },
  { code: 'MEDICATION', name: 'Medication / Injection', category: 'General', priceBdt: 300, duration: 10, description: 'Chairside medication administration' },
];

export function seedReferenceData(db: DB, now: number): void {
  const tx = db.transaction(() => {
    // Permissions
    const insPerm = db.prepare(
      'INSERT INTO permissions (code, description) VALUES (?, ?) ON CONFLICT(code) DO NOTHING',
    );
    for (const p of PERMISSIONS) insPerm.run(p, '');

    // Roles
    const insRole = db.prepare(
      `INSERT INTO roles (name, description, is_builtin, created_at)
       VALUES (?, ?, 1, ?) ON CONFLICT(name) DO NOTHING`,
    );
    const getRole = db.prepare('SELECT id FROM roles WHERE name = ?');
    const linkPerm = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)',
    );
    for (const role of BUILT_IN_ROLES) {
      insRole.run(role.name, role.description, now);
      const row = getRole.get(role.name) as { id: number };
      for (const perm of role.permissions) linkPerm.run(row.id, perm);
    }

    // Teeth
    const insTooth = db.prepare(
      `INSERT OR IGNORE INTO teeth (fdi, dentition, quadrant, position, universal, palmer, label, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of buildTeeth()) {
      insTooth.run(t.fdi, t.dentition, t.quadrant, t.position, t.universal, t.palmer, t.label, t.region);
    }

    // Tooth conditions
    const insCond = db.prepare(
      `INSERT OR IGNORE INTO tooth_conditions (code, label, category, color, is_custom, sort_order)
       VALUES (?, ?, ?, ?, 0, ?)`,
    );
    TOOTH_CONDITIONS.forEach((c, i) => insCond.run(c.code, c.label, c.category, c.color, i));

    // Clinical options
    const insOpt = db.prepare(
      `INSERT OR IGNORE INTO clinical_options (section, code, label, is_builtin) VALUES (?, ?, ?, 1)`,
    );
    for (const o of CLINICAL_OPTIONS) insOpt.run(o.section, o.code, o.label);

    // Expense categories
    const insCat = db.prepare(
      'INSERT OR IGNORE INTO expense_categories (name, is_builtin, is_active) VALUES (?, 1, 1)',
    );
    for (const c of BUILT_IN_EXPENSE_CATEGORIES) insCat.run(c);

    // Treatments (only if catalog empty)
    const treatmentCount = (db.prepare('SELECT COUNT(*) AS n FROM treatments').get() as { n: number }).n;
    if (treatmentCount === 0) {
      const insTx = db.prepare(
        `INSERT INTO treatments (code, name, category, default_price_poisha, description, duration_minutes, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      );
      for (const t of DEFAULT_TREATMENTS) {
        insTx.run(t.code, t.name, t.category, t.priceBdt * 100, t.description, t.duration, now, now);
      }
    }

    // Printer profiles are created by setup.complete per the wizard's suggested-profiles
    // choice — NOT re-seeded here, so deleting a profile is respected across restarts.

    // Clinic config row
    db.prepare(
      'INSERT INTO clinic_config (id, clinic_name, updated_at) VALUES (1, \'\', ?) ON CONFLICT(id) DO NOTHING',
    ).run(now);
  });
  tx();
}
