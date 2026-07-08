/**
 * Sample TS code for indexer tests. Cobre os node types que symbols.ts extrai.
 */

export class AuthService {
  private token: string = "";

  validateToken(token: string): boolean {
    return token.length > 0;
  }

  refresh(): string {
    this.token = "new-" + Math.random();
    return this.token;
  }
}

export function makeAuth(): AuthService {
  return new AuthService();
}

export function deprecated_helper(x: number): number {
  return x * 2;
}

export const VERSION = "1.0.0";