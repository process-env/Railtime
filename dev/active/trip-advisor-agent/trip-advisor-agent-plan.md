# Trip Advisor Agent - Implementation Plan

**Created**: 2025-12-09
**Full Plan Location**: `C:\Users\User\.claude\plans\foamy-drifting-bonbon.md`

## Quick Reference

### Transfer Station Data (Complete - 30+ Complexes)

#### All-Division Transfers (IRT/IND/BMT)
| Complex | Station IDs | Routes | Walk Time |
|---------|-------------|--------|-----------|
| 14th St-Sixth Ave | L03, F14, 123 | 1,2,3,F,M,L | 180s |
| Times Square-42nd St | 127, 902, 725, R16 | 1,2,3,7,N,Q,R,W,S,A,C,E | 240s |
| 59th St-Lexington Ave | 629, R11, F15* | 4,5,6,N,R,W,F,Q | 180s/300s* |
| Fulton St | A38, 229, J25, M22 | A,C,J,Z,2,3,4,5 | 180s |

#### IRT/IND Transfers
| Complex | Station IDs | Routes | Walk Time |
|---------|-------------|--------|-----------|
| Bryant Park-42nd St | D15, 723 | 7,B,D,F,M | 180s |
| 53rd St-Lexington Ave | E01, 631 | E,M,6 | 120s |
| Columbus Circle-59th St | 125, A24 | 1,A,B,C,D | 180s |
| 74th St-Roosevelt Ave | 710, G14 | 7,E,F,M,R | 180s |
| 161st St-Yankee Stadium | 415, D11 | 4,B,D | 120s |
| 168th St | 112, A06 | 1,A,C | 180s |
| Court Square | 718, F09, G22 | 7,E,M,G | 180s |
| WTC/Park Place | E04, 229 | E,2,3 | 120s |
| Bleecker St | 640, D21 | 6,B,D,F,M | 120s |

#### IRT/BMT Transfers
| Complex | Station IDs | Routes | Walk Time |
|---------|-------------|--------|-----------|
| Union Square-14th St | 635, L01, R20 | 4,5,6,L,N,Q,R,W | 180s |
| Atlantic Ave-Barclays | 235, D24, R31 | 2,3,4,5,B,D,N,Q,R | 180s |
| Borough Hall-Court St | 234, R28 | 2,3,4,5,R | 120s |
| Canal St | 637, J21, R23 | 6,J,Z,N,Q,R,W | 180s |
| Chambers St | 417, J26 | 4,5,6,J,Z | 180s |
| Queensboro Plaza | 715, R09 | 7,N,W | 120s |
| Botanic Garden | 239, S04 | 2,3,4,5,S | 120s |

#### IND/BMT Transfers
| Complex | Station IDs | Routes | Walk Time |
|---------|-------------|--------|-----------|
| 4th Ave-9th St | F20, R36 | F,G,R | 120s |
| 14th St-Eighth Ave | A31, L02 | A,C,E,L | 120s |
| Herald Square-34th St | D17, R17 | B,D,F,M,N,Q,R,W | 180s |
| Broadway Junction | A51, J27, L22 | A,C,J,Z,L | 180s |
| Essex-Delancey | F16, J19 | F,M,J,Z | 120s |
| Lorimer St-Metropolitan | G29, L17 | G,L | 120s |
| Jamaica Center | G08, J31 | E,J,Z | 120s |
| Sutphin Blvd | G07, J30 | E,J,Z | 120s |

#### Out-of-System Transfers (MetroCard/OMNY)
| Complex | Station IDs | Routes | Walk Time |
|---------|-------------|--------|-----------|
| Lex 59th/63rd | 629, F15 | 4,5,6,N,R,W ↔ F,Q | 300s |
| Livonia/Junius | L27, 253 | L ↔ 3 | 300s |

*Note: Station IDs need validation against stops.txt*

---

## Algorithm: Dijkstra with Transfer Penalty

```typescript
function calculateEdgeCost(edge, options) {
  let cost = edge.durationSeconds;
  if (edge.type === 'transfer') {
    cost += 300; // 5 min penalty
  }
  if (edge.transferType === 'out-of-system') {
    cost += 60; // Additional 1 min
  }
  return cost;
}
```

---

## Key Type Definitions

```typescript
interface GraphNode {
  stationId: string;
  routeId: string;
}

interface TripSegment {
  type: 'board' | 'ride' | 'transfer' | 'exit';
  routeId?: string;
  fromStation: { id: string; name: string };
  toStation: { id: string; name: string };
  durationSeconds: number;
  stopCount?: number;
}

interface TripPlan {
  segments: TripSegment[];
  totalDurationSeconds: number;
  totalTransfers: number;
  routes: string[];
}
```

---

## API Design

```
GET /api/v1/trip?origin=127&destination=635&alternatives=3

Response:
{
  "trips": [TripPlan, TripPlan, TripPlan],
  "origin": "127",
  "destination": "635",
  "requestedAt": "2025-12-09T15:30:00Z"
}
```
