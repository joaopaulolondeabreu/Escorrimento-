/**
 * Bateria de testes canônicos do solver (§7.1) via Vitest.
 * Os mesmos testes rodam em `npm run validate` com relatório detalhado.
 */

import { describe, expect, it } from 'vitest';
import {
  hydrostaticTest, divergenceTest, massConservationTest,
  poiseuilleTest, taylorGreenTest, damBreakTest, determinismTest,
} from './canonical';

describe('Testes canônicos do solver (§7.1)', () => {
  it('repouso hidrostático: vel. espúria < 1e-3 m/s, pressão linear < 0.5%', () => {
    const r = hydrostaticTest();
    console.log(r.name, r.metrics);
    expect(r.pass, JSON.stringify(r.metrics)).toBe(true);
  });

  it('divergência pós-projeção < 1e-4', () => {
    const r = divergenceTest();
    console.log(r.name, r.metrics);
    expect(r.pass, JSON.stringify(r.metrics)).toBe(true);
  });

  it('conservação de massa: deriva < 1% em 30 s', () => {
    const r = massConservationTest();
    console.log(r.name, r.metrics);
    expect(r.pass, JSON.stringify(r.metrics)).toBe(true);
  });

  it('Poiseuille: perfil parabólico, erro L2 < 2%', () => {
    const r = poiseuilleTest();
    console.log(r.name, r.metrics);
    expect(r.pass, JSON.stringify(r.metrics)).toBe(true);
  });

  it('Taylor–Green: decaimento dentro de 5%', () => {
    const r = taylorGreenTest();
    console.log(r.name, r.metrics);
    expect(r.pass, JSON.stringify(r.metrics)).toBe(true);
  });

  it('dam break vs Martin & Moyce: erro < 8%', () => {
    const r = damBreakTest();
    console.log(r.name, r.metrics);
    expect(r.pass, JSON.stringify(r.metrics)).toBe(true);
  });

  it('determinismo: execuções idênticas', () => {
    const r = determinismTest();
    console.log(r.name, r.metrics);
    expect(r.pass, JSON.stringify(r.metrics)).toBe(true);
  });
});
