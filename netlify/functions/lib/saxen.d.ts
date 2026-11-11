declare module "saxen" {
  export class Parser {
    on(event: string, callback: (...args: any[]) => void): this;
    parse(xml: string): unknown;
  }
}
