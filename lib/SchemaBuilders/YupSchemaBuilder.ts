import * as path from 'path';
import * as Defaults from '../defaults';
import { SchemaProgram, ICompilerOptions } from '../SchemaProgram';
import { BaseSchemaBuilder, SchemaType, IImportDeclaration, IExportDeclaration, IEnumDeclaration, IInterfaceDeclaration, ITypeDeclaration, IMemberDeclaration, Indexer, INumberSchemaType, ITupleSchemaType, IUnionSchemaType, IArraySchemaType, IObjectSchemaType, IStringSchemaType, ITypeAccessSchemaType, ITypeReferenceSchemaType, INewLiteralSchemaType, ILiteralSchemaType, IBaseSchemaType, IIntersectionSchemaType } from './BaseSchemaBuilder';

interface IRenderContext {
  readonly isRequired: boolean
  addTempType(type: SchemaType | string): string
  tsignore(): void
}

export class YupSchemaBuilder extends BaseSchemaBuilder {
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
      return `import * as Yup from 'yup';\n\n${result}`;
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
      ...declaration.members.map((member) => `    ${member.name}: Yup.mixed().oneOf([${member.value}] as const),`),
      `  };`,
      `  return {`,
      `    ...Yup.mixed().oneOf([${declaration.members.map((member) => member.value).join(', ')}] as const),`,
      `    members,`,
      `  };`,
      `})()\n\n`,
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
    return `export const ${this.toSchemaName(declaration.name)} = Yup.object()${heritage}${members}.strict(true);\n\n`;
  }

  private renderTypes(): string {
    const types = this.schema.types.filter((declaration) => this.referencedNames.has(declaration.name));
    return types.map((declaration) => this.renderType(declaration)).join('');
  }

  private renderType(declaration: ITypeDeclaration): string {
    return `export const ${this.toSchemaName(declaration.name)} = ${this.indent(() => this.renderSchemaType(declaration.type))}.strict(true);\n\n`;
  }

  private renderSchemaType(type: SchemaType, required = false): string {
    let tempCount = 0;
    let tsignore = false;
    const temps: Array<{ name: string, type: string }> = [];
    this.contexts.push({
      isRequired: required,
      addTempType: (type) => {
        const temp = `t${++tempCount}`;
        temps.push({
          name: temp,
          type: `Yup.${typeof type === 'string' ? type : this.indent(() => this.renderRule(type))})`
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
      const tempsRender = temps.map((temp) => `\n${indent}const ${temp.name} = ${temp.type}.strict(true);`).join('');
      return `(() => {${tempsRender}\n${indent}${tsignore ? '// @ts-ignore' : ''}\n${indent}return Yup.${rule}\n${this.indent(-1)}})()`;
    }

    return `Yup.${rule}`;
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
      case 'new-literal': return this.renderNewLiteral(type);
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
    return 'mixed()';
  }

  private renderFunc(_type: IBaseSchemaType<'func'>): string {
    throw new Error('Function not supported');
  }

  private renderDate(_type: IBaseSchemaType<'date'>): string {
    return this.required('date()');
  }

  private renderBuffer(_type: IBaseSchemaType<'buffer'>): string {
    throw new Error('Buffer not supported');
  }

  private renderSymbol(_type: IBaseSchemaType<'symbol'>): string {
    throw new Error('Symbol not supported');
  }

  private renderNull(_type: IBaseSchemaType<'null'>): string {
    return this.required('mixed().oneOf([null] as const)');
  }

  private renderNever(_type: IBaseSchemaType<'never'>): string {
    throw new Error('Never not supported');
  }

  private renderBoolean(_type: IBaseSchemaType<'boolean'>): string {
    return this.required('boolean()');
  }

  private renderUndefined(_type: IBaseSchemaType<'undefined' | 'void'>): string {
    return this.required('mixed().oneOf([undefined] as const)');
  }

  private renderLiteral(type: ILiteralSchemaType): string {
    return this.required(`mixed().oneOf([${type.rawLiteral}] as const)`);
  }

  private renderNewLiteral(type: INewLiteralSchemaType): string {
    if (typeof type.value === 'object') { throw new Error('BigInt not supported'); } else return `mixed().oneOf([${JSON.stringify(type.value)}] as const)`;
  }

  private renderTypeReference(type: ITypeReferenceSchemaType): string {
    return `lazy(() => ${this.required(this.toSchemaName(type.name))})`;
  }

  private renderTypeAccess(type: ITypeAccessSchemaType): string {
    return `lazy(() => ${this.required(this.getAccessName(type.name, type.access))})`;
  }

  private renderString(type: IStringSchemaType): string {
    return this.required(`string()${type.regex ? `.matches(${type.regex})` : ''}`);
  }

  private renderObject(type: IObjectSchemaType): string {
    return this.required(`object()${this.renderMembers(type.members)}`);
  }

  private renderArray(type: IArraySchemaType): string {
    return this.required(`array().of(${this.renderSchemaType(type.of)})`);
  }

  private renderUnion(_type: IUnionSchemaType): string {
    throw new Error('Union not supported');
  }

  private renderTuple(_type: ITupleSchemaType): string {
    throw new Error('Tuple not supported');
  }

  private renderNumber(type: INumberSchemaType): string {
    const num = [
      'number()',
      type.integer ? '.integer()' : false,
      type.min !== undefined ? `.min(${type.min})` : false,
      type.max !== undefined ? `.max(${type.max})` : false,
    ];
    return this.required(num.filter((part) => part !== false).join(''));
  }

  private renderBigInt(_type: IBaseSchemaType<'bigint'>): string {
    throw new Error('BigInt not supported');
  }

  private renderIntersection(_type: IIntersectionSchemaType): string {
    throw new Error('Intersection currently not supported');
  }

  private required(type: string): string {
    return `${type}${this.context.isRequired ? '.required()' : ''}`;
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
      return `.shape({\n${properties}${this.indent(-1)}})${this.renderIndexer(indexer)}`;
    }
    return '';
  }

  private renderMember(member: IMemberDeclaration): string {
    const indent = this.indent();
    if (member.indexer) {
      return '';
    }
    const type = this.indent(() => this.renderSchemaType(member.type, member.required));
    return `${indent}${member.name}: ${type},\n`;
  }

  private renderIndexer(member: IMemberDeclaration | undefined): string {
    if (member && member.indexer) {
      throw new Error('Indexer currently not supported');
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