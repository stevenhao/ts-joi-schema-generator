import * as commander from 'commander';
import * as fs from 'fs-extra';
import * as Defaults from './defaults';

import { SchemaProgram, ICompilerOptions } from './SchemaProgram';
export { SchemaProgram, ICompilerOptions };

/**
 * Main entry point when used from the command line.
 */
export async function main(): Promise<void> {
  commander
  .description('Create runtime validator module from TypeScript interfaces')
  .usage('[options] -- <tsc-options...>')
  .option('-s, --schema-suffix <postfix>', `Postfix to append to generated Joi schemas (default ${Defaults.schemaSuffix})`, Defaults.schemaSuffix)
  .option('-f, --file-suffix <suffix>', `Suffix to append to generated files (default ${Defaults.fileSuffix})`, Defaults.fileSuffix)
  .option('-o, --outDir <path>', 'Directory for output files; same as source file if omitted')
  .option('-r, --render <type>', 'Schema type to render (accepts: joi, joi-15, yup, yup-0.19; default: joi)', Defaults.render)
  .allowUnknownOption()
  .parse(process.argv);

  const tscArgs: string[] = commander.args;
  const fileSuffix: string = commander.fileSuffix;
  const schemaSuffix: string = commander.schemaSuffix;
  const outDir: string|undefined = commander.outDir;
  const render: ICompilerOptions['render'] = commander.render;

  if (!['joi', 'joi-15', 'yup', 'yup-0.19'].includes(render)) {
    throw new Error('Invalid render type: ' + render);
  }

  const options: ICompilerOptions = {
    tsconfig: commander.config,
    outDir,
    fileSuffix,
    schemaSuffix,
    render,
    //files: files.length === 0 ? undefined : files
    tscArgs: [...(commander.project ? ['-p', commander.project] : []), ...tscArgs],
  };

  const result = SchemaProgram.compile(options);
  await Promise.all(result.map((compileResult) => fs.outputFile(compileResult.schemaFile, compileResult.content)));
}
