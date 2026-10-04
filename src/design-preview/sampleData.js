// TEMPORARY - made-up sample data for /design-preview only.
// Quantities only (no money), and nothing here comes from or goes to the database.

export const SAMPLE_USER = { name: 'Thabo Nkosi', role: 'Site manager' }

export const SAMPLE_PROJECTS = [
  { id: 'p1', name: 'R21 Culvert Upgrade', code: 'NK-26-014' },
  { id: 'p2', name: 'Olifantsfontein Stormwater', code: 'NK-26-009' },
  { id: 'p3', name: 'Ext 25 Access Roads', code: 'NK-25-031' },
]

export const SAMPLE_EMPLOYEES = [
  { id: 'e1', name: 'Sipho Mahlangu', role: 'Site agent' },
  { id: 'e2', name: 'Lerato Molefe', role: 'Operator' },
  { id: 'e3', name: 'Johannes van Wyk', role: 'Operator' },
  { id: 'e4', name: 'Nomvula Dlamini', role: 'Semi-skilled' },
  { id: 'e5', name: 'Bongani Zulu', role: 'General worker' },
  { id: 'e6', name: 'Themba Ndlovu', role: 'General worker' },
  { id: 'e7', name: 'Pieter Botha', role: 'Diver' },
]

export const SAMPLE_EQUIPMENT = [
  { id: 'q1', name: 'CAT 320 excavator', role: 'Own' },
  { id: 'q2', name: 'Bell B20 dump truck', role: 'Rented' },
  { id: 'q3', name: 'JCB 3CX TLB', role: 'Own' },
  { id: 'q4', name: 'Bomag BW 120 roller', role: 'Rented' },
  { id: 'q5', name: 'Water bowser 10 kL', role: 'Own' },
]

// alert: a "yes" here is a warning (shown in red), not a box ticked.
export const SAFETY_ITEMS = [
  { key: 'dsti', label: 'DSTI done' },
  { key: 'audit', label: 'Internal audit' },
  { key: 'nearMiss', label: 'Near miss', alert: true },
  { key: 'moment', label: 'Safety moment' },
]
