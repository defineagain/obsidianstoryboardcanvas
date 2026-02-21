declare module 'monkey-around' {
  export function around(obj: any, factories: Record<string, any>): any;
  export function dedupe(key: string, old: Function, factory: Function): Function;
}
