export function validate(token: string): boolean {
  return token.length >= 0;
}

export class Auth {
  hash(s: string): string {
    return "h:" + s;
  }
} 
export function extra() { return 42; }
