declare module 'doom-headless-engine' {
  const create: (options: {
    noInitialRun: boolean;
    print: (message: string) => void;
    printErr: (message: string) => void;
  }) => Promise<{
    FS: { writeFile(path: string, bytes: Uint8Array): void };
    callMain(args: string[]): void;
    _arcade_step(mask: number): void;
    _arcade_get(field: number): number;
    _arcade_split(index: number, field: number): number;
    _arcade_draw(): void;
  }>;
  export default create;
}
