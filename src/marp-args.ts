export type MarpOutputFormat = "pdf" | "pptx";

export interface BuildMarpArgsInput {
  readonly mdPath: string;
  readonly outputPath: string;
  readonly format: MarpOutputFormat;
  readonly editable: boolean;
  readonly themePath: string | null;
}

export function buildMarpArgs(input: BuildMarpArgsInput): string[] {
  const args = [
    input.mdPath,
    "--no-stdin",
    "--allow-local-files",
    "-o",
    input.outputPath,
  ];
  if (input.format === "pdf") {
    args.push("--pdf");
  } else {
    args.push("--pptx");
    if (input.editable) args.push("--pptx-editable");
  }
  if (input.themePath !== null) {
    args.push("--theme", input.themePath);
  }
  return args;
}
