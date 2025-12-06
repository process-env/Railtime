// MTA Elevator & Escalator (E&E) API Types

export interface EquipmentOutage {
  station: string;
  borough: string;
  trainno: string;
  equipment: string;
  equipmenttype: 'EL' | 'ES'; // EL = Elevator, ES = Escalator
  serving: string;
  ADA: 'Y' | 'N';
  outagedate: string;
  estimatedreturntoservice: string;
  reason: string;
  isupcomingoutage: 'Y' | 'N';
  ismaintenanceoutage: 'Y' | 'N';
}

export interface Equipment {
  station: string;
  borough: string;
  trainno: string;
  equipmentno: string;
  equipmenttype: 'EL' | 'ES';
  serving: string;
  ADA: 'Y' | 'N';
  isactive: 'Y' | 'N';
  nonNYCT: 'Y' | 'N';
  shortdescription: string;
  linesservedbyelevator: string;
  elevatorsgtfsstopid: string;
  elevatormrn: string;
  stationcomplexid: string;
  nextadanorth: string;
  nextadasouth: string;
  redundant: number;
  busconnections: string;
  alternativeroute: string;
}

// Processed types for UI
export interface ProcessedOutage {
  id: string;
  station: string;
  routes: string[];
  equipmentId: string;
  type: 'elevator' | 'escalator';
  serving: string;
  isADA: boolean;
  outageStart: Date;
  estimatedReturn: Date;
  reason: string;
  isUpcoming: boolean;
  isMaintenance: boolean;
  daysOut: number;
}

export interface EquipmentStats {
  totalElevators: number;
  totalEscalators: number;
  elevatorOutages: number;
  escalatorOutages: number;
  adaAffected: number;
  upcomingOutages: number;
}

export interface EquipmentStatusResponse {
  currentOutages: ProcessedOutage[];
  upcomingOutages: ProcessedOutage[];
  stats: EquipmentStats;
  updatedAt: string;
}
