/**
 * Protocolo de mensagens entre a thread principal (UI/render) e o worker
 * da simulação. O solver roda inteiramente no worker para nunca travar a
 * interface (§8: sem congelamentos > 100 ms).
 */

import type { IntakeParams } from '../solver/intake2d';
import type { SolverParams2D, StepDiagnostics } from '../solver/solver2d';
import type { IntakeMeasurement } from '../physics/probes2d';

/** Campos escalares disponíveis no modo científico (§5.5). */
export type FieldKind = 'speed' | 'pressure' | 'vorticity' | 'divergence';

export interface InitMsg {
  type: 'init';
  nx: number;
  intake: IntakeParams;
  solver: Partial<SolverParams2D>;
}

export interface SetParamsMsg {
  type: 'setParams';
  /** Reconstrói a cena (geometria/grade) se true. */
  rebuild: boolean;
  nx?: number;
  intake?: Partial<IntakeParams>;
  solver?: Partial<SolverParams2D>;
}

export interface RunControlMsg {
  type: 'run';
  running: boolean;
}

export interface SingleStepMsg { type: 'singleStep'; }
export interface ResetMsg { type: 'reset'; }

export interface SetSpeedMsg {
  type: 'speed';
  /** Escala de tempo (câmera lenta): 1.0, 0.25, 0.1, 0.02. */
  timeScale: number;
}

export interface RequestFrameMsg {
  type: 'requestFrame';
  wantFields: boolean;
  field: FieldKind;
  wantTracers: boolean;
}

export interface SweepMsg {
  type: 'sweep';
  vValues: number[];
  settleTime: number;
  measureTime: number;
}
export interface SweepCancelMsg { type: 'sweepCancel'; }

export type MainToWorker =
  | InitMsg | SetParamsMsg | RunControlMsg | SingleStepMsg | ResetMsg
  | SetSpeedMsg | RequestFrameMsg | SweepMsg | SweepCancelMsg;

// ---------------------------------------------------------------- respostas

export interface GeometryInfo {
  nx: number;
  ny: number;
  dx: number;
  domainW: number;
  domainH: number;
  /** Máscara de célula sólida (0/1), nx×ny — para desenhar a geometria. */
  solidMask: Uint8Array;
  /** Geometria derivada para sondas/câmeras. */
  xC: number; yC: number; yA: number; xTube: number;
  mouthY0: number; mouthY1: number;
  resX0: number; resX1: number; resFloorY: number;
  waterDepth: number;
}

export interface FrameMsg {
  type: 'frame';
  time: number;
  /** Posições das partículas intercaladas (x0,y0,x1,y1,...). */
  positions: Float32Array;
  /** |velocidade| por partícula (para coloração). */
  speeds: Float32Array;
  count: number;
  diag: StepDiagnostics;
  measurement: IntakeMeasurement | null;
  /** Campo escalar do modo científico (nx×ny) + limites, se pedido. */
  field: Float32Array | null;
  fieldMin: number;
  fieldMax: number;
  cellType: Uint8Array | null;
  /** Perfil de pressão ao longo do eixo do tubo: pares (z, p′medido). */
  tubeProfile: Float32Array | null;
  /** Vetores de velocidade esparsos: quádruplas (x, y, u, v). */
  vectors: Float32Array | null;
  /** Traçadores: segmentos das trajetórias + flag capturado. */
  tracers: Array<{ captured: boolean; pts: Float32Array }> | null;
  /** Velocidade real da simulação (s de simulação por s de parede). */
  simRate: number;
}

export interface ReadyMsg {
  type: 'ready';
  geometry: GeometryInfo;
}

export interface SweepPoint {
  V: number;
  vNozzle: number;
  flux: number;
  overpressureC: number;
  captureFraction: number;
  dragForce: number;
  power: number;
}

export interface SweepProgressMsg {
  type: 'sweepProgress';
  done: number;
  total: number;
  currentV: number;
  points: SweepPoint[];
  finished: boolean;
}

export type WorkerToMain = ReadyMsg | FrameMsg | SweepProgressMsg;
