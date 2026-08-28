/** Tipos do codificador de QR Code (scripts/qr.mjs). */
export declare function qrMatriz(
  texto: string,
  opcoes?: { mascaraFixa?: number | null },
): boolean[][] | null;
export declare function qrTerminal(
  texto: string,
  opcoes?: { cor?: boolean },
): string | null;
