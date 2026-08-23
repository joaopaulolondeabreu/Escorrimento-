/**
 * Transferências partícula↔grade do método APIC (§3.2.1 e §3.2.8).
 *
 * Kernel: B-spline quadrática N(x), suporte |x| < 1.5 nós:
 *   N(x) = 3/4 − x²           para |x| < 1/2
 *   N(x) = (3/2 − |x|)²/2     para 1/2 ≤ |x| < 3/2
 *
 * Os pesos são avaliados pela DISTÂNCIA REAL da partícula a cada nó
 * (nunca por offset pré-tabelado com índice grampeado): perto das bordas o
 * stencil perde nós, a soma de pesos cai abaixo de 1 e por isso TODAS as
 * reduções são normalizadas pela soma efetiva. Grampear o índice sem
 * recalcular o peso produziria pesos NEGATIVOS e velocidades explosivas —
 * este foi um modo de falha real encontrado durante o desenvolvimento.
 *
 * P2G (APIC): momento com termo afim,
 *   m_i·u_i = Σ_p w_ip·m_p·[ u_p + C_p·(x_i − x_p) ]
 * G2P: além da velocidade, reconstrói a matriz afim
 *   C_p = D_p⁻¹·Σ_i w_ip·u_i·(x_i − x_p)ᵀ / Σ_i w_ip,
 * com D_p = (Δx²/4)·I para a B-spline quadrática em grade uniforme.
 */

import { Grid2D } from './grid2d';
import { Particles2D } from './particles2d';

/** B-spline quadrática avaliada na distância x (em unidades de célula). */
function quadN(x: number): number {
  const a = Math.abs(x);
  if (a < 0.5) return 0.75 - a * a;
  if (a < 1.5) {
    const t = 1.5 - a;
    return 0.5 * t * t;
  }
  return 0;
}

// Buffers do stencil 3×3 (evita alocação por partícula)
const sIdxX = new Int32Array(3);
const sIdxY = new Int32Array(3);
const sWX = new Float64Array(3);
const sWY = new Float64Array(3);

/**
 * Monta o stencil 1D de 3 nós em torno de g (coordenada de grade): índices
 * válidos em [0, nMax] e pesos N(g − i). Retorna o nº de nós válidos e
 * marca `stencilTruncated` quando algum nó caiu fora da grade — nesse caso
 * a matriz D_p ≠ (Δx²/4)·I e a reconstrução afim NÃO pode usar o D⁻¹
 * padrão (um stencil de nó único interpretaria a velocidade como um falso
 * gradiente ~u/Δx² e explodiria o APIC — modo de falha real observado).
 */
let stencilTruncated = false;

function stencil1D(g: number, nMax: number, idx: Int32Array, w: Float64Array): number {
  const base = Math.floor(g - 0.5);
  if (base < 0 || base + 2 > nMax) stencilTruncated = true;
  let n = 0;
  for (let d = 0; d < 3; d++) {
    const i = base + d;
    if (i < 0 || i > nMax) continue;
    const weight = quadN(g - i);
    if (weight <= 0) continue;
    idx[n] = i;
    w[n] = weight;
    n++;
  }
  return n;
}

function p2gComponent(
  parts: Particles2D, vel: Float64Array, cxArr: Float64Array, cyArr: Float64Array,
  out: Float64Array, outMass: Float64Array,
  nxNodes: number, nyNodes: number, dx: number, ox: number, oy: number,
): void {
  out.fill(0);
  outMass.fill(0);
  const inv = 1 / dx;
  for (let p = 0; p < parts.count; p++) {
    const gx = parts.x[p] * inv - ox;
    const gy = parts.y[p] * inv - oy;
    const nX = stencil1D(gx, nxNodes - 1, sIdxX, sWX);
    const nY = stencil1D(gy, nyNodes - 1, sIdxY, sWY);
    const vp = vel[p];
    const cx = cxArr[p];
    const cy = cyArr[p];
    for (let b = 0; b < nY; b++) {
      const nodeY = (sIdxY[b] + oy) * dx;
      const ry = nodeY - parts.y[p];
      const row = sIdxY[b] * nxNodes;
      for (let a = 0; a < nX; a++) {
        const w = sWX[a] * sWY[b];
        const nodeX = (sIdxX[a] + ox) * dx;
        const rx = nodeX - parts.x[p];
        const k = row + sIdxX[a];
        out[k] += w * (vp + cx * rx + cy * ry);
        outMass[k] += w;
      }
    }
  }
  for (let k = 0; k < out.length; k++) {
    if (outMass[k] > 1e-12) out[k] /= outMass[k];
    else { out[k] = 0; outMass[k] = 0; }
  }
}

/** P2G completo: transfere u e v das partículas para a grade MAC. */
export function particlesToGrid(parts: Particles2D, g: Grid2D): void {
  p2gComponent(parts, parts.u, parts.cux, parts.cuy, g.u, g.uMass,
    g.nx + 1, g.ny, g.dx, 0, 0.5);
  p2gComponent(parts, parts.v, parts.cvx, parts.cvy, g.v, g.vMass,
    g.nx, g.ny + 1, g.dx, 0.5, 0);
  for (let k = 0; k < g.u.length; k++) g.uValid[k] = g.uMass[k] > 0 ? 1 : 0;
  for (let k = 0; k < g.v.length; k++) g.vValid[k] = g.vMass[k] > 0 ? 1 : 0;
  g.uOld.set(g.u);
  g.vOld.set(g.v);
}

/**
 * G2P: atualiza velocidade e matriz afim das partículas.
 * Blend FLIP/PIC (§3.2.8): u_p ← α·(u_p + Δu_grade) + (1−α)·u_grade.
 */
export function gridToParticles(parts: Particles2D, g: Grid2D, alpha: number): void {
  const inv = 1 / g.dx;
  // Guarda de condicionamento: no interior det(Cov) = (Δx²/4)², perto do
  // contorno a covariância degenera — abaixo do piso, reconstrução constante.
  const dRef = (g.dx * g.dx) / 4;
  const detMin = 1e-4 * dRef * dRef;

  for (let p = 0; p < parts.count; p++) {
    // -------- componente u (grade: ox=0, oy=0.5)
    let picU = 0, dU = 0, cux = 0, cuy = 0;
    {
      const gx = parts.x[p] * inv;
      const gy = parts.y[p] * inv - 0.5;
      const nX = stencil1D(gx, g.nx, sIdxX, sWX);
      const nY = stencil1D(gy, g.ny - 1, sIdxY, sWY);
      let wsum = 0, bx = 0, by = 0;
      let dxx = 0, dxy = 0, dyy = 0;
      let mxAcc = 0, myAcc = 0;
      for (let b = 0; b < nY; b++) {
        const nodeY = (sIdxY[b] + 0.5) * g.dx;
        const ry = nodeY - parts.y[p];
        const row = sIdxY[b] * (g.nx + 1);
        for (let a = 0; a < nX; a++) {
          const w = sWX[a] * sWY[b];
          const k = row + sIdxX[a];
          const nodeX = sIdxX[a] * g.dx;
          const rx = nodeX - parts.x[p];
          const un = g.u[k];
          picU += w * un;
          dU += w * (un - g.uOld[k]);
          bx += w * un * rx;
          by += w * un * ry;
          dxx += w * rx * rx;
          dxy += w * rx * ry;
          dyy += w * ry * ry;
          mxAcc += w * rx;
          myAcc += w * ry;
          wsum += w;
        }
      }
      if (wsum > 1e-12) {
        picU /= wsum; dU /= wsum;
        // Reconstrução afim por mínimos quadrados ponderados CENTRADOS:
        //   C = Cov_w(r, u) · Cov_w(r, r)⁻¹.
        // No interior, Σw·r = 0 e isto se reduz ao APIC canônico
        // (Jiang et al. 2015) com D = (Δx²/4)·I. Perto do contorno o
        // stencil é assimétrico (Σw·r ≠ 0): sem centralizar, o valor MÉDIO
        // do campo contaminaria o gradiente (~u/Δx — explosivo).
        const mx = mxAcc / wsum, my = myAcc / wsum;
        const bcx = bx / wsum - picU * mx;
        const bcy = by / wsum - picU * my;
        const cxx = dxx / wsum - mx * mx;
        const cxy = dxy / wsum - mx * my;
        const cyy = dyy / wsum - my * my;
        const det = cxx * cyy - cxy * cxy;
        if (det > detMin) {
          const invDet = 1 / det;
          cux = (bcx * cyy - bcy * cxy) * invDet;
          cuy = (bcy * cxx - bcx * cxy) * invDet;
        }
      }
    }
    // -------- componente v (grade: ox=0.5, oy=0)
    let picV = 0, dV = 0, cvx = 0, cvy = 0;
    {
      const gx = parts.x[p] * inv - 0.5;
      const gy = parts.y[p] * inv;
      const nX = stencil1D(gx, g.nx - 1, sIdxX, sWX);
      const nY = stencil1D(gy, g.ny, sIdxY, sWY);
      let wsum = 0, bx = 0, by = 0;
      let dxx = 0, dxy = 0, dyy = 0;
      let mxAcc = 0, myAcc = 0;
      for (let b = 0; b < nY; b++) {
        const nodeY = sIdxY[b] * g.dx;
        const ry = nodeY - parts.y[p];
        const row = sIdxY[b] * g.nx;
        for (let a = 0; a < nX; a++) {
          const w = sWX[a] * sWY[b];
          const k = row + sIdxX[a];
          const nodeX = (sIdxX[a] + 0.5) * g.dx;
          const rx = nodeX - parts.x[p];
          const vn = g.v[k];
          picV += w * vn;
          dV += w * (vn - g.vOld[k]);
          bx += w * vn * rx;
          by += w * vn * ry;
          dxx += w * rx * rx;
          dxy += w * rx * ry;
          dyy += w * ry * ry;
          mxAcc += w * rx;
          myAcc += w * ry;
          wsum += w;
        }
      }
      if (wsum > 1e-12) {
        picV /= wsum; dV /= wsum;
        const mx = mxAcc / wsum, my = myAcc / wsum;
        const bcx = bx / wsum - picV * mx;
        const bcy = by / wsum - picV * my;
        const cxx = dxx / wsum - mx * mx;
        const cxy = dxy / wsum - mx * my;
        const cyy = dyy / wsum - my * my;
        const det = cxx * cyy - cxy * cxy;
        if (det > detMin) {
          const invDet = 1 / det;
          cvx = (bcx * cyy - bcy * cxy) * invDet;
          cvy = (bcy * cxx - bcx * cxy) * invDet;
        }
      }
    }

    // Blend FLIP (α) / PIC (1−α)
    parts.u[p] = alpha * (parts.u[p] + dU) + (1 - alpha) * picU;
    parts.v[p] = alpha * (parts.v[p] + dV) + (1 - alpha) * picV;
    // Matriz afim sempre reconstruída do campo novo (APIC)
    parts.cux[p] = cux;
    parts.cuy[p] = cuy;
    parts.cvx[p] = cvx;
    parts.cvy[p] = cvy;
  }
}
