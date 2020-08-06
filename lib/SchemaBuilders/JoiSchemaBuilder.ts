import * as path from 'path';
import * as Defaults from '../defaults';
import { SchemaProgram, ICompilerOptions } from '../SchemaProgram';
import { BaseSchemaBuilder, SchemaType, IImportDeclaration, IExportDeclaration, IEnumDeclaration, IInterfaceDeclaration, ITypeDeclaration, IMemberDeclaration, Indexer, IBaseSchemaType, ILiteralSchemaType, ITypeReferenceSchemaType, ITypeAccessSchemaType, IStringSchemaType, IObjectSchemaType, IArraySchemaType, IUnionSchemaType, ITupleSchemaType, INumberSchemaType, IIntersectionSchemaType } from './BaseSchemaBuilder';

interface IRenderContext {
  addTempType(type: SchemaType | string): string
  tsignore(): void
}

export class JoiSchemaBuilder extends BaseSchemaBuilder {
  private indentation = 0
  private contexts: IRenderContext[] = []

  private get context(): IRenderContext {
    return this.contexts[this.contexts.length - 1];
  }

  constructor(program: SchemaProgram, file: string, options: ICompilerOptions) {
    super(program, file, options);
  }

  public render(): string | null {
    const result = `${this.renderImports()}${this.renderExports()}\n${this.renderEnums()}${this.renderInterfaces()}${this.renderTypes()}`.trim();
    if (result) {
      return `import * as Joi from '@hapi/joi';\n\n${result}`;
    }
    return null;
  }

  private renderImports(): string {
    const imports = this.getUsedImports();
    return imports.map((declaration) => this.renderImportExport('import', declaration)).join('');
  }

  private renderExports(): string {
    const exports = this.getUsedExports();
    return exports.map((declaration) => this.renderImportExport('export', declaration)).join('');
  }

  private renderImportExport(type: 'export' | 'import', declaration: IImportDeclaration | IExportDeclaration): string {
    const namedBindings = declaration.namedBindings.map(binding => {
      if (binding.bound) {
        return `${this.toSchemaName(binding.bound)} as ${this.toSchemaName(binding.name)}`;
      }
      return this.toSchemaName(binding.name);
    });

    let from = '';
    if (declaration.file) {
      const filePath = declaration.file;
      const { dir, name } = path.parse(filePath);
      const outPath = path.format({ dir: this.options.outDir || dir, name: `${name}${this.options.fileSuffix || Defaults.fileSuffix}` });
      from = ` from './${path.relative(this.options.outDir || './', outPath)}'`;
    }

    return `${type} { ${namedBindings.join(', ')} }${from};\n`;
  }

  private renderEnums(): string {
    const enums = this.schema.enums.filter((declaration) => this.referencedNames.has(declaration.name));
    return enums.map((declaration) => this.renderEnum(declaration)).join('');
  }

  private renderEnum(declaration: IEnumDeclaration): string {
    const name = this.toSchemaName(declaration.name);
    const r: string[] = [
      `export const ${name} = (() => {`,
      `  const members = {`,
      ...declaration.members.map((member) => `    ${member.name}: Joi.valid(${member.value}).required(),`),
      `  };`,
      `  return {`,
      `    ...Joi.valid(${declaration.members.map((member) => member.value).join(', ')}).required(),`,
      `    members,`,
      `  };`,
      `})();\n\n`,
    ];
    return r.join('\n');
  }

  private renderInterfaces(): string {
    const interfaces = this.schema.interfaces
      .filter((declaration) => this.referencedNames.has(declaration.name))
      .sort((a, b) => {
        if (a.heritages.some((decl) => decl.type === 'type-reference' && decl.name === b.name)) {
          return -1;
        }
        if (b.heritages.some((decl) => decl.type === 'type-reference' && decl.name === a.name)) {
          return 1;
        }
        return 0;
      });
    return interfaces.map((declaration) => this.renderInterface(declaration)).join('');
  }

  private renderInterface(declaration: IInterfaceDeclaration): string {
    const heritage = declaration.heritages.map((heritage) => heritage.type === 'type-reference' ? `.concat(${this.toSchemaName(heritage.name)})` : '');
    const members = this.indent(() => this.renderMembers(declaration.members));
    return `export const ${this.toSchemaName(declaration.name)} = Joi.object()${heritage}${members}.required().strict();\n\n`;
  }

  private renderTypes(): string {
    const types = this.schema.types.filter((declaration) => this.referencedNames.has(declaration.name));
    return types.map((declaration) => this.renderType(declaration)).join('');
  }

  private renderType(declaration: ITypeDeclaration): string {
    return `export const ${this.toSchemaName(declaration.name)} = ${this.indent(() => this.renderSchemaType(declaration.type))}.strict();\n\n`;
  }

  private renderSchemaType(type: SchemaType, requiredOverride?: boolean): string {
    let tempCount = 0;
    let tsignore = false;

    const temps: Array<{ name: string, type: string }> = [];
    this.contexts.push({
      addTempType: (type) => {
        const temp = `t${++tempCount}`;
        temps.push({
          name: temp,
          type: `Joi.${typeof type === 'string' ? type : this.indent(() => this.renderRule(type))}`
        });
        return temp;
      },
      tsignore() {
        tsignore = true;
      }
    });

    const rule = this.renderRule(type);
    this.contexts.pop();

    if (tempCount > 0) {
      const indent = this.indent();
      const tempsRender = temps.map((temp) => `\n${indent}const ${temp.name} = ${temp.type}.strict();`).join('');
      return `(() => {${tempsRender}\n${indent}${tsignore ? '// @ts-ignore' : ''}\n${indent}return Joi.${rule}\n${this.indent(-1)}})()`;
    }

    return `Joi.${rule}${(requiredOverride ?? type.required) ? '.required()' : ''}`;
  }


  private renderRule(type: SchemaType): string {
    switch (type.type) {
      case 'unknown':
      case 'any': return this.renderAny(type);
      case 'func': return this.renderFunc(type);
      case 'date': return this.renderDate(type);
      case 'buffer': return this.renderBuffer(type);
      case 'symbol': return this.renderSymbol(type);
      case 'null': return this.renderNull(type);
      case 'never': return this.renderNever(type);
      case 'boolean': return this.renderBoolean(type);
      case 'void':
      case 'undefined': return this.renderUndefined(type);
      case 'literal': return this.renderLiteral(type);
      case 'type-reference': return this.renderTypeReference(type);
      case 'type-access': return this.renderTypeAccess(type);
      case 'string': return this.renderString(type);
      case 'object': return this.renderObject(type);
      case 'array': return this.renderArray(type);
      case 'union': return this.renderUnion(type);
      case 'tuple': return this.renderTuple(type);
      case 'number': return this.renderNumber(type);
      case 'bigint': return this.renderBigInt(type);
      case 'intersection': return this.renderIntersection(type);
    }
  }

  private renderAny(_type: IBaseSchemaType<'any' | 'unknown'>): string {
    return 'any()';
  }

  private renderFunc(_type: IBaseSchemaType<'func'>): string {
    return 'func()';
  }

  private renderDate(_type: IBaseSchemaType<'date'>): string {
    return 'date()';
  }

  private renderBuffer(_type: IBaseSchemaType<'buffer'>): string {
    return 'binary()';
  }

  private renderSymbol(_type: IBaseSchemaType<'symbol'>): string {
    return 'symbol()';
  }

  private renderNull(_type: IBaseSchemaType<'null'>): string {
    return 'valid(null)';
  }

  private renderNever(_type: IBaseSchemaType<'never'>): string {
    return 'forbidden()';
  }

  private renderBoolean(_type: IBaseSchemaType<'boolean'>): string {
    return 'boolean()';
  }

  private renderUndefined(_type: IBaseSchemaType<'undefined' | 'void'>): string  {
    return 'valid([]).optional()';
  }

  private renderLiteral(type: ILiteralSchemaType): string {
    if (typeof type.value === 'object') { throw new Error('BigInt not supported'); } else return `valid(${JSON.stringify(type.value)})`;
  }

  private renderTypeReference(type: ITypeReferenceSchemaType): string {
    return `lazy(() => ${this.toSchemaName(type.name)})`;
  }

  private renderTypeAccess(type: ITypeAccessSchemaType): string {
    return `lazy(() => ${this.getAccessName(type.name, type.access)})`;
  }

  private renderString(type: IStringSchemaType): string {
    const { regex, name } = type.regex ?? {};
    return `string()${regex ? `.regex(${regex}${name ? `, ${JSON.stringify(name)}` : ''})` : ''}`;
  }

  private renderObject(type: IObjectSchemaType): string {
    return `object()${this.renderMembers(type.members)}`;
  }

  private renderArray(type: IArraySchemaType): string {
    return [
      `array().items(${this.renderSchemaType(type.of, false)})`,
      type.minLength === undefined ? '' : `.min(${type.minLength})`,
      type.maxLength === undefined ? '' : `.max(${type.maxLength})`,
      type.of.required ? '' : '.sparse()',
    ].join('');
  }

  private renderUnion(type: IUnionSchemaType): string {
    return `alternatives(\n${type.of.map((t) => this.renderTypeListItem(t)).join('')}${this.indent(-1)})`;
  }

  private renderTuple(type: ITupleSchemaType): string {
    // Note: Tuples do NOT support undefined/empty fillers! This is due to Joi being weird.
    let rule = `array().ordered(\n${type.of.map((t) => this.renderTypeListItem(t)).join('')}${this.indent(-1)})`;
    const rest = type.restElement;
    if (rest) {
      rule = `${rule}.items(${this.renderSchemaType(rest, false)})`;
    }
    return `${rule}`;
  }

  private renderTypeListItem(type: SchemaType): string {
    const indent = this.indent();
    const schemaType = this.indent(() => this.renderSchemaType(type));
    return `${indent}${schemaType},\n`;
  }

  private renderNumber(type: INumberSchemaType): string {
    return `number()${type.integer ? '.integer()' : ''}${type.min !== undefined ? `.min(${type.min})` : ''}${type.max !== undefined ? `.max(${type.max})` : ''}`;
  }

  private renderBigInt(_type: IBaseSchemaType<'bigint'>): string {
    throw new Error('BigInt not supported');
  }

  private renderIntersection(_type: IIntersectionSchemaType): string {
    throw new Error('Intersection not supported for @hapi/joi@1.15');
    /*
    const of = type.of;
    const objects = of.filter((type) => type.type === 'object');
    const unions = of.filter((type) => type.type === 'union');
    if ((objects.length + unions.length) < of.length) {
      throw new Error(`Invalid intersection`);
    }

    const baseConcats = objects.map((type) => `\n${this.indent()}.concat(${this.renderSchemaType(type)})`);
    const baseObject = `object()${baseConcats.join('')}`;

    if (unions.length === 0) {
      return baseObject;
    }

    const indent = this.indent(1);
    const baseJoi = this.context.addTempType(baseObject);
    const unionsJoi = unions.map((union) => this.context.addTempType(union));
    const declarations = `\n${indent}const options = { ...helpers.prefs, allowUnknown: true };\n${indent}let result;`;

    const checks = [baseJoi, ...unionsJoi].map((temp) => {
      return `\n${indent}result = ${temp}.validate(value, options);\n${indent}if (result.error) throw result.error;`;
    }).join('');

    this.context.tsignore();
    return `custom((value, helpers) => {${declarations}${checks}\n${indent}return value;\n${this.indent()}})`;
    */
  }

  private getAccessName(type: string | null, access: string): string {
    let name = 'members';
    if (type) {
      name = `${this.toSchemaName(type)}.${name}`;
    }

    if (access.startsWith('\'')) {
      return `${name}[${access}]`;
    }
    return `${name}.${access}`;
  }

  private renderMembers(members: IMemberDeclaration[] | undefined): string {
    if (members && members.length > 0) {
      const indexer = members.find((member) => member.indexer);
      const properties = members.map((member) => this.renderMember(member)).join('');
      return `.keys({\n${properties}${this.indent(-1)}})${this.renderIndexer(indexer)}`;
    }
    return '';
  }

  private renderMember(member: IMemberDeclaration): string {
    const indent = this.indent();
    if (member.indexer) {
      return '';
    }
    const type = this.indent(() => this.renderSchemaType(member.type));
    return `${indent}${member.text}: ${type},\n`;
  }

  private renderIndexer(member: IMemberDeclaration | undefined): string {
    if (member && member.indexer) {
      const pattern = this.renderIndexerPattern(member.indexer);
      return `.pattern(${pattern}, ${this.renderSchemaType(member.type)})`;
    }
    return '';
  }

  private renderIndexerPattern(indexer: Indexer): string {
    switch (indexer.type) {
      case 'number': return '/^\\d+(.\\d+)?$/';
      case 'string': {
        if (indexer.pattern) {
          return indexer.pattern;
        }
        return '/^.*$/';
      }
    }
  }

  private toSchemaName(name: string): string {
    return `${name}${this.options.schemaSuffix === undefined ? Defaults.schemaSuffix : this.options.schemaSuffix}`;
  }

  private indent(funcOrOffset?: (() => string) | number): string {
    if (!funcOrOffset || typeof funcOrOffset === 'number') {
      return ''.padEnd((this.indentation + (funcOrOffset ?? 0)) * 2, ' ');
    }
    this.indentation++;
    const result = funcOrOffset();
    this.indentation--;
    return result;
  }
}