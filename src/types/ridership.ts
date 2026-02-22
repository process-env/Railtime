export interface RidershipDay {
  date: string; // e.g. "2026-02-21T00:00:00.000"
  ridership: number; // daily total estimated ridership
  prePandemicPercent: number; // e.g. 78.5
}

export interface RidershipResponse {
  days: RidershipDay[];
  latest: RidershipDay | null;
  avgDaily: number; // average over returned days
  totalRidership: number;
  dailyFareRevenue: number; // latest day ridership x $3.00
  updatedAt: string;
}
