/**
 * FERN canonical catalogues.
 *
 * Everything in this file is the single source of truth shared by the UI, the
 * scoring engine and the SQL seed data. Keys MUST stay in sync with
 * `supabase/migrations/*` -- see docs/SPECIFICATION.md section 5.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const USER_ROLES = [
  'super_admin',
  'hospital_admin',
  'shift_in_charge',
  'referral_coordinator',
  'viewer',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'System Administrator',
  hospital_admin: 'Hospital Administrator',
  shift_in_charge: 'Shift In-Charge',
  referral_coordinator: 'Referral Coordinator',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: 'Full access across every hospital, including configuration and user management.',
  hospital_admin: 'Manages their own hospital: departments, staff, readiness compliance, reports.',
  shift_in_charge: 'Submits departmental readiness updates for each shift.',
  referral_coordinator: 'Raises referral requests and responds to incoming referrals.',
  viewer: 'Read-only access to dashboards and reports for their hospital.',
}

/** Capability matrix. Mirrors the RLS policies in `0002_rls.sql`. */
export const ROLE_CAPABILITIES = {
  super_admin: [
    'readiness:submit',
    'readiness:view',
    'referral:create',
    'referral:respond',
    'referral:view',
    'messaging:use',
    'reports:view',
    'reports:view_all',
    'admin:hospital',
    'admin:system',
    'audit:view',
  ],
  hospital_admin: [
    'readiness:submit',
    'readiness:view',
    'referral:create',
    'referral:respond',
    'referral:view',
    'messaging:use',
    'reports:view',
    'admin:hospital',
    'audit:view',
  ],
  shift_in_charge: ['readiness:submit', 'readiness:view', 'referral:view', 'messaging:use'],
  referral_coordinator: [
    'readiness:view',
    'referral:create',
    'referral:respond',
    'referral:view',
    'messaging:use',
    'reports:view',
  ],
  viewer: ['readiness:view', 'referral:view', 'reports:view'],
} as const satisfies Record<UserRole, readonly string[]>

export type Capability = (typeof ROLE_CAPABILITIES)[UserRole][number]

// ---------------------------------------------------------------------------
// Readiness status
// ---------------------------------------------------------------------------

export const READINESS_STATUSES = ['green', 'yellow', 'red'] as const
export type ReadinessStatus = (typeof READINESS_STATUSES)[number]

export const READINESS_LABELS: Record<ReadinessStatus, string> = {
  green: 'Current',
  yellow: 'Overdue',
  red: 'Stale',
}

export const READINESS_DESCRIPTIONS: Record<ReadinessStatus, string> = {
  green: 'Updated for the current shift.',
  yellow: 'Not updated in the last shift.',
  red: 'Not updated in the last three shifts.',
}

// ---------------------------------------------------------------------------
// Shifts (3 x 8h). Windows are expressed in the hospital's local timezone.
// ---------------------------------------------------------------------------

export const SHIFT_TYPES = ['morning', 'afternoon', 'night'] as const
export type ShiftType = (typeof SHIFT_TYPES)[number]

export interface ShiftWindow {
  type: ShiftType
  label: string
  /** Inclusive start hour, local time, 0-23. */
  startHour: number
  /** Exclusive end hour, local time, 0-24. Night wraps past midnight. */
  endHour: number
}

export const SHIFT_WINDOWS: readonly ShiftWindow[] = [
  { type: 'morning', label: 'Morning (07:00 - 15:00)', startHour: 7, endHour: 15 },
  { type: 'afternoon', label: 'Afternoon (15:00 - 23:00)', startHour: 15, endHour: 23 },
  { type: 'night', label: 'Night (23:00 - 07:00)', startHour: 23, endHour: 7 },
]

export const SHIFTS_PER_DAY = SHIFT_WINDOWS.length
export const SHIFT_LENGTH_HOURS = 8

export const DEFAULT_TIMEZONE = import.meta.env?.VITE_DEFAULT_TIMEZONE || 'Africa/Accra'

// ---------------------------------------------------------------------------
// Resource catalogue
// ---------------------------------------------------------------------------

export const RESOURCE_KINDS = ['boolean', 'count', 'percent'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export interface ResourceDefinition {
  key: ResourceKey
  label: string
  kind: ResourceKind
  /** Column on `hospital_resources` holding the current value. */
  column: string
  /** Companion capacity column, for count resources that track a denominator. */
  totalColumn?: string
  /**
   * Quantity treated as "fully available" when scoring a count resource.
   * Availability saturates at 1.0 once this many units are free.
   */
  saturationQuantity?: number
  unit?: string
  group: 'critical_care' | 'surgical' | 'diagnostics' | 'supplies' | 'logistics'
  help?: string
}

export const RESOURCE_KEYS = [
  'operating_room',
  'resident_surgeon',
  'anesthetist',
  'obstetric_theatre',
  'neurosurgery',
  'cath_lab',
  'icu_bed',
  'nicu_bed',
  'neonatal_resuscitation',
  'ventilator',
  'oxygen',
  'isolation_bed',
  'general_bed',
  'burn_unit',
  'dialysis',
  'blood_bank',
  'ct_scan',
  'mri',
  'xray',
  'ultrasound',
  'ambulance',
  'power_backup',
] as const

export type ResourceKey = (typeof RESOURCE_KEYS)[number]

export const RESOURCES: Record<ResourceKey, ResourceDefinition> = {
  operating_room: {
    key: 'operating_room',
    label: 'Functional operating room',
    kind: 'count',
    column: 'operating_rooms_functional',
    totalColumn: 'operating_rooms_total',
    saturationQuantity: 1,
    unit: 'rooms',
    group: 'surgical',
    help: 'Theatres that are fully functional and free to receive a case this shift.',
  },
  resident_surgeon: {
    key: 'resident_surgeon',
    label: 'Resident surgeon on site',
    kind: 'boolean',
    column: 'resident_surgeon_available',
    group: 'surgical',
    help: 'A surgeon physically present and able to operate this shift.',
  },
  anesthetist: {
    key: 'anesthetist',
    label: 'Anaesthetist on site',
    kind: 'boolean',
    column: 'anesthetist_available',
    group: 'surgical',
  },
  obstetric_theatre: {
    key: 'obstetric_theatre',
    label: 'Obstetric theatre ready',
    kind: 'boolean',
    column: 'obstetric_theatre_available',
    group: 'surgical',
  },
  neurosurgery: {
    key: 'neurosurgery',
    label: 'Neurosurgical capability',
    kind: 'boolean',
    column: 'neurosurgery_available',
    group: 'surgical',
  },
  cath_lab: {
    key: 'cath_lab',
    label: 'Cardiac catheterisation lab',
    kind: 'boolean',
    column: 'cath_lab_available',
    group: 'surgical',
  },
  icu_bed: {
    key: 'icu_bed',
    label: 'ICU beds free',
    kind: 'count',
    column: 'icu_beds_available',
    totalColumn: 'icu_beds_total',
    saturationQuantity: 2,
    unit: 'beds',
    group: 'critical_care',
  },
  nicu_bed: {
    key: 'nicu_bed',
    label: 'NICU cots free',
    kind: 'count',
    column: 'nicu_beds_available',
    totalColumn: 'nicu_beds_total',
    saturationQuantity: 2,
    unit: 'cots',
    group: 'critical_care',
  },
  neonatal_resuscitation: {
    key: 'neonatal_resuscitation',
    label: 'Neonatal resuscitation ready',
    kind: 'boolean',
    column: 'neonatal_resuscitation_available',
    group: 'critical_care',
  },
  ventilator: {
    key: 'ventilator',
    label: 'Ventilators free',
    kind: 'count',
    column: 'ventilators_available',
    totalColumn: 'ventilators_total',
    saturationQuantity: 2,
    unit: 'units',
    group: 'critical_care',
  },
  oxygen: {
    key: 'oxygen',
    label: 'Oxygen supply level',
    kind: 'percent',
    column: 'oxygen_supply_percent',
    unit: '%',
    group: 'supplies',
    help: 'Percentage of normal working stock currently held (cylinders + plant).',
  },
  isolation_bed: {
    key: 'isolation_bed',
    label: 'Isolation beds free',
    kind: 'count',
    column: 'isolation_beds_available',
    saturationQuantity: 1,
    unit: 'beds',
    group: 'critical_care',
  },
  general_bed: {
    key: 'general_bed',
    label: 'General beds free',
    kind: 'count',
    column: 'general_beds_available',
    totalColumn: 'general_beds_total',
    saturationQuantity: 5,
    unit: 'beds',
    group: 'critical_care',
  },
  burn_unit: {
    key: 'burn_unit',
    label: 'Burns unit able to admit',
    kind: 'boolean',
    column: 'burn_unit_available',
    group: 'critical_care',
  },
  dialysis: {
    key: 'dialysis',
    label: 'Dialysis available',
    kind: 'boolean',
    column: 'dialysis_available',
    group: 'critical_care',
  },
  blood_bank: {
    key: 'blood_bank',
    label: 'Blood bank functional',
    kind: 'boolean',
    column: 'blood_bank_functional',
    group: 'supplies',
    help: 'Per-group unit counts are captured separately in the blood stock table.',
  },
  ct_scan: {
    key: 'ct_scan',
    label: 'CT scanner working',
    kind: 'boolean',
    column: 'ct_functional',
    group: 'diagnostics',
  },
  mri: {
    key: 'mri',
    label: 'MRI working',
    kind: 'boolean',
    column: 'mri_functional',
    group: 'diagnostics',
  },
  xray: {
    key: 'xray',
    label: 'X-ray working',
    kind: 'boolean',
    column: 'xray_functional',
    group: 'diagnostics',
  },
  ultrasound: {
    key: 'ultrasound',
    label: 'Ultrasound working',
    kind: 'boolean',
    column: 'ultrasound_functional',
    group: 'diagnostics',
  },
  ambulance: {
    key: 'ambulance',
    label: 'Ambulances free',
    kind: 'count',
    column: 'ambulances_available',
    saturationQuantity: 1,
    unit: 'vehicles',
    group: 'logistics',
  },
  power_backup: {
    key: 'power_backup',
    label: 'Power backup working',
    kind: 'boolean',
    column: 'power_backup_available',
    group: 'logistics',
  },
}

export const RESOURCE_GROUP_LABELS: Record<ResourceDefinition['group'], string> = {
  critical_care: 'Critical care & beds',
  surgical: 'Surgical & theatre',
  diagnostics: 'Diagnostics & imaging',
  supplies: 'Supplies',
  logistics: 'Logistics',
}

// ---------------------------------------------------------------------------
// Blood groups
// ---------------------------------------------------------------------------

export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const
export type BloodGroup = (typeof BLOOD_GROUPS)[number]

// ---------------------------------------------------------------------------
// Department templates -- decide which resource fields a department submits.
// ---------------------------------------------------------------------------

export const DEPARTMENT_TEMPLATE_KEYS = [
  'emergency',
  'theatre',
  'icu',
  'nicu',
  'maternity',
  'surgery',
  'radiology',
  'blood_bank',
  'renal',
  'cardiology',
  'burns',
  'general',
] as const

export type DepartmentTemplateKey = (typeof DEPARTMENT_TEMPLATE_KEYS)[number]

export interface DepartmentTemplate {
  key: DepartmentTemplateKey
  label: string
  /** Resource fields this department is responsible for reporting each shift. */
  resources: readonly ResourceKey[]
  /** Whether the form also collects per-group blood stock. */
  collectsBloodStock?: boolean
  /** Whether the form controls the hospital-wide ER open / on-diversion flag. */
  controlsErStatus?: boolean
}

export const DEPARTMENT_TEMPLATES: Record<DepartmentTemplateKey, DepartmentTemplate> = {
  emergency: {
    key: 'emergency',
    label: 'Emergency / Casualty',
    resources: ['general_bed', 'isolation_bed', 'ambulance', 'power_backup', 'oxygen'],
    controlsErStatus: true,
  },
  theatre: {
    key: 'theatre',
    label: 'Main Theatre',
    resources: ['operating_room', 'resident_surgeon', 'anesthetist'],
  },
  icu: {
    key: 'icu',
    label: 'Intensive Care Unit',
    resources: ['icu_bed', 'ventilator', 'oxygen', 'dialysis'],
  },
  nicu: {
    key: 'nicu',
    label: 'Neonatal Intensive Care',
    resources: ['nicu_bed', 'neonatal_resuscitation', 'oxygen'],
  },
  maternity: {
    key: 'maternity',
    label: 'Maternity / Obstetrics',
    resources: ['obstetric_theatre', 'neonatal_resuscitation', 'anesthetist'],
  },
  surgery: {
    key: 'surgery',
    label: 'Surgery',
    resources: ['resident_surgeon', 'neurosurgery', 'operating_room'],
  },
  radiology: {
    key: 'radiology',
    label: 'Radiology / Imaging',
    resources: ['ct_scan', 'mri', 'xray', 'ultrasound'],
  },
  blood_bank: {
    key: 'blood_bank',
    label: 'Blood Bank',
    resources: ['blood_bank'],
    collectsBloodStock: true,
  },
  renal: { key: 'renal', label: 'Renal / Dialysis', resources: ['dialysis'] },
  cardiology: { key: 'cardiology', label: 'Cardiology', resources: ['cath_lab'] },
  burns: { key: 'burns', label: 'Burns Unit', resources: ['burn_unit', 'isolation_bed'] },
  general: {
    key: 'general',
    label: 'General Ward',
    resources: ['general_bed', 'oxygen'],
  },
}

// ---------------------------------------------------------------------------
// Referral lifecycle
// ---------------------------------------------------------------------------

export const REFERRAL_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'in_transit',
  'completed',
  'cancelled',
  'expired',
] as const

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  in_transit: 'In transit',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

/** Statuses that still need somebody to act. */
export const ACTIVE_REFERRAL_STATUSES: readonly ReferralStatus[] = [
  'pending',
  'accepted',
  'in_transit',
]

export const URGENCY_LEVELS = ['critical', 'urgent', 'routine'] as const
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number]

export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  critical: 'Critical - immediate',
  urgent: 'Urgent - within hours',
  routine: 'Routine - planned',
}

/** Average road speed assumed per urgency band, km/h. Used for ETA estimates. */
export const URGENCY_TRANSPORT_SPEED_KMH: Record<UrgencyLevel, number> = {
  critical: 60,
  urgent: 50,
  routine: 40,
}

export const AGE_BANDS = [
  'neonate',
  'infant',
  'child',
  'adolescent',
  'adult',
  'older_adult',
] as const
export type AgeBand = (typeof AGE_BANDS)[number]

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  neonate: 'Neonate (0-28 days)',
  infant: 'Infant (1-12 months)',
  child: 'Child (1-11 years)',
  adolescent: 'Adolescent (12-17 years)',
  adult: 'Adult (18-64 years)',
  older_adult: 'Older adult (65+ years)',
}

export const PATIENT_SEXES = ['female', 'male', 'other', 'undisclosed'] as const
export type PatientSex = (typeof PATIENT_SEXES)[number]

export const REFERRAL_OUTCOMES = [
  'transferred',
  'stabilised_on_site',
  'referred_elsewhere',
  'died_before_transfer',
  'declined_by_patient',
  'other',
] as const
export type ReferralOutcome = (typeof REFERRAL_OUTCOMES)[number]

export const REFERRAL_OUTCOME_LABELS: Record<ReferralOutcome, string> = {
  transferred: 'Transferred and received',
  stabilised_on_site: 'Stabilised at referring facility',
  referred_elsewhere: 'Referred to another facility',
  died_before_transfer: 'Died before transfer completed',
  declined_by_patient: 'Declined by patient / family',
  other: 'Other',
}

// ---------------------------------------------------------------------------
// Scoring defaults. Overridable at runtime via the `scoring_config` table.
// ---------------------------------------------------------------------------

export interface ScoringConfig {
  /** Weight applied to the resource sub-score. Spec: 70%. */
  resourceWeight: number
  /** Weight applied to the proximity sub-score. Spec: 30%. */
  proximityWeight: number
  /** Multiplicative penalty applied when readiness is yellow (0.15 = -15%). */
  yellowPenalty: number
  /** Multiplicative penalty applied when readiness is red. */
  redPenalty: number
  /** ETA beyond which proximity scores 0. */
  maxEtaMinutes: number
  /** Straight-line distance beyond which a hospital is not considered at all. */
  maxDistanceKm: number
  /** Road distance is estimated as great-circle distance x this factor. */
  roadDistanceFactor: number
  /** Fixed minutes added to every ETA for dispatch / handover. */
  fixedTransportOverheadMinutes: number
  /**
   * Scores within this many percentage points are treated as tied; ties are
   * then ordered by historical acceptance rate, as required by the spec.
   */
  tieBreakEpsilon: number
  /** Hospitals whose readiness is red are excluded outright when true. */
  excludeRedHospitals: boolean
  /** A hospital on diversion (er_open = false) is never recommended. */
  excludeHospitalsOnDiversion: boolean
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  resourceWeight: 0.7,
  proximityWeight: 0.3,
  yellowPenalty: 0.15,
  redPenalty: 0.35,
  maxEtaMinutes: 180,
  maxDistanceKm: 250,
  roadDistanceFactor: 1.3,
  fixedTransportOverheadMinutes: 10,
  tieBreakEpsilon: 0.5,
  excludeRedHospitals: false,
  excludeHospitalsOnDiversion: true,
}

// ---------------------------------------------------------------------------
// Hospital classification
// ---------------------------------------------------------------------------

export const HOSPITAL_LEVELS = [
  'health_centre',
  'primary',
  'district',
  'secondary',
  'tertiary',
  'specialist',
] as const
export type HospitalLevel = (typeof HOSPITAL_LEVELS)[number]

export const HOSPITAL_LEVEL_LABELS: Record<HospitalLevel, string> = {
  health_centre: 'Health Centre',
  primary: 'Primary / CHPS',
  district: 'District Hospital',
  secondary: 'Regional / Secondary',
  tertiary: 'Teaching / Tertiary',
  specialist: 'Specialist Centre',
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  'readiness_overdue',
  'referral_incoming',
  'referral_accepted',
  'referral_declined',
  'referral_in_transit',
  'referral_completed',
  'referral_cancelled',
  'message_received',
  'system',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.failed_login',
  'readiness.submit',
  'referral.create',
  'referral.accept',
  'referral.decline',
  'referral.in_transit',
  'referral.complete',
  'referral.cancel',
  'message.send',
  'hospital.create',
  'hospital.update',
  'department.create',
  'department.update',
  'user.invite',
  'user.update_role',
  'user.deactivate',
  'config.update',
  'report.export',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const APP_NAME = import.meta.env?.VITE_APP_NAME || 'FERN'
export const APP_TAGLINE = 'Referral Ready State'
export const SUPPORT_EMAIL = import.meta.env?.VITE_SUPPORT_EMAIL || 'support@example.org'

/** A pending referral with no response after this long is escalated in the UI. */
export const REFERRAL_RESPONSE_TARGET_MINUTES = 15

/** Free-text clinical summary cap -- keeps records terse and PHI-light. */
export const CLINICAL_SUMMARY_MAX_LENGTH = 1000
