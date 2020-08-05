import * as path from 'path';
import { SchemaProgram, ICompilerOptions } from '../SchemaProgram';
import * as ts from 'typescript';

export interface INamedBinding {
  bound?: string
  name: string
}

export interface IExportDeclaration {
  file?: string
  namedBindings: INamedBinding[]
}

export interface IImportDeclaration {
  file: string
  namedBindings: INamedBinding[]
}

export interface IInterfaceDeclaration {
  name: string
  heritages: SchemaType[]
  members: IMemberDeclaration[]
}

export interface ITypeDeclaration {
  name: string
  type: SchemaType
}

export interface IEnumDeclaration {
  name: string
  members: IEnumMember[]
}

export interface IEnumMember {
  name: string
  value: string
}

export interface IMemberDeclaration {
  name: string
  indexer?: Indexer
  type: SchemaType
}

export type Indexer = {
  type: 'number'
} | {
  type: 'string'
  pattern?: string
}

export interface IBaseSchemaType<T extends string> {
  type: T
  required?: boolean
}

export interface IStringSchemaType extends IBaseSchemaType<'string'> {
  regex?: string
}

export interface INumberSchemaType extends IBaseSchemaType<'number'> {
  integer?: boolean
  min?: number
  max?: number
}

export interface IObjectSchemaType extends IBaseSchemaType<'object'> {
  members?: IMemberDeclaration[]
}

export interface ITypeReferenceSchemaType extends IBaseSchemaType<'type-reference'> {
  name: string
}

export interface ITypeAccessSchemaType extends IBaseSchemaType<'type-access'> {
  name: string
  access: string
}

export interface IArraySchemaType extends IBaseSchemaType<'array'> {
  of: SchemaType
}

export interface ITupleSchemaType extends IBaseSchemaType<'tuple'> {
  of: SchemaType[]
  minLength: number
  restElement?: SchemaType
}

export interface IUnionSchemaType extends IBaseSchemaType<'union'> {
  of: SchemaType[]
}

export interface IIntersectionSchemaType extends IBaseSchemaType<'intersection'> {
  of: SchemaType[]
}

export interface ILiteralSchemaType extends IBaseSchemaType<'literal'> {
  value: string | number | ts.PseudoBigInt | boolean
}

export type SchemaType =
  | IBaseSchemaType<'any'>
  | IBaseSchemaType<'unknown'>
  | IBaseSchemaType<'boolean'>
  | IBaseSchemaType<'bigint'>
  | IBaseSchemaType<'symbol'>
  | IBaseSchemaType<'void'>
  | IBaseSchemaType<'undefined'>
  | IBaseSchemaType<'null'>
  | IBaseSchemaType<'never'>
  | IBaseSchemaType<'func'>
  | IBaseSchemaType<'date'>
  | IBaseSchemaType<'buffer'>
  | IStringSchemaType
  | INumberSchemaType
  | IObjectSchemaType
  | ITypeReferenceSchemaType
  | ITypeAccessSchemaType
  | IArraySchemaType
  | ITupleSchemaType
  | IUnionSchemaType
  | IIntersectionSchemaType
  | ILiteralSchemaType
  ;

export interface ISchema {
  file: string
  exports: IExportDeclaration[]
  imports: IImportDeclaration[]
  interfaces: IInterfaceDeclaration[]
  types: ITypeDeclaration[]
  enums: IEnumDeclaration[]
}

export interface IJoiRenderContext {
  addTempType(type: SchemaType | string): string
  tsignore(): void
}

export abstract class BaseSchemaBuilder {
  protected program: SchemaProgram;
  protected options: ICompilerOptions;

  protected schema: ISchema;
  protected referencedNames = new Set<string>();

  private finalized = false;

  constructor(program: SchemaProgram, file: string, options: ICompilerOptions) {
    this.program = program;
    this.options = options;
    this.schema = {
      file,
      enums: [],
      types: [],
      exports: [],
      imports: [],
      interfaces: []
    };
  }

  public abstract render(): string | null

  public writeImport(declaration: IImportDeclaration): void {
    this.schema.imports.push(declaration);
  }

  public writeExport(declaration: IExportDeclaration): void {
    this.schema.exports.push(declaration);
  }

  public writeInterface(declaration: IInterfaceDeclaration, shouldRender: boolean): void {
    this.schema.interfaces.push(declaration);

    if (shouldRender) {
      this.useInterface(declaration);
    }
  }

  public writeType(declaration: ITypeDeclaration, shouldRender: boolean): void {
    this.schema.types.push(declaration);

    if (shouldRender) {
      this.useType(declaration);
    }
  }

  public writeEnum(declaration: IEnumDeclaration, shouldRender: boolean): void {
    this.schema.enums.push(declaration);

    if (shouldRender) {
      this.useEnum(declaration);
    }
  }

  public getUsedImports(): IImportDeclaration[] {
    return this.schema.imports
      .map((declaration) => {
        return {
          file: declaration.file,
          namedBindings: declaration.namedBindings.filter((binding) => this.referencedNames.has(binding.name))
        };
      })
      .filter((declaration) => declaration.namedBindings.length > 0);
  }

  public getUsedExports(): IExportDeclaration[] {
    return this.schema.exports
      .map((declaration) => {
        return {
          file: declaration.file,
          namedBindings: declaration.namedBindings.filter((binding) => this.referencedNames.has(binding.name))
        };
      })
      .filter((declaration) => declaration.namedBindings.length > 0);
  }

  public use(name: string): void {
    const iface = this.schema.interfaces.find((declaration) => declaration.name === name);
    if (iface) {
      this.useInterface(iface);
      return;
    }

    const type = this.schema.types.find((declaration) => declaration.name === name);
    if (type) {
      this.useType(type);
      return;
    }

    const enumeration = this.schema.enums.find((declaration) => declaration.name === name);
    if (enumeration) {
      this.useEnum(enumeration);
      return;
    }

    if (this.finalized) {
      for (const declaration of this.schema.imports) {
        for (const binding of declaration.namedBindings) {
          if (name === binding.name && !this.referencedNames.has(binding.name)) {
            this.program.use(this.resolveSourceFile(declaration.file), binding.bound || binding.name);
          }
        }
      }

      for (const declaration of this.schema.exports) {
        if (declaration.file) {
          for (const binding of declaration.namedBindings) {
            if (name === binding.name && !this.referencedNames.has(binding.name)) {
              this.program.use(this.resolveSourceFile(declaration.file), binding.bound || binding.name);
            }
          }
        }
      }
    }

    this.referencedNames.add(name);
  }

  public finalize(): void {
    const imports = this.getUsedImports();
    for (const declaration of imports) {
      for (const binding of declaration.namedBindings) {
        this.program.use(this.resolveSourceFile(declaration.file), binding.bound || binding.name);
      }
    }

    const exports = this.getUsedExports();
    for (const declaration of exports) {
      if (declaration.file) {
        for (const binding of declaration.namedBindings) {
          this.program.use(this.resolveSourceFile(declaration.file), binding.bound || binding.name);
        }
      }
    }

    this.finalized = true;
  }

  private useInterface(declaration: IInterfaceDeclaration): void {
    if (!this.referencedNames.has(declaration.name)) {
      this.referencedNames.add(declaration.name);
      for (const heritage of declaration.heritages) {
        this.reference(heritage);
      }
      for (const member of declaration.members) {
        this.reference(member.type);
      }
    }
  }

  private useType(declaration: ITypeDeclaration): void {
    if (!this.referencedNames.has(declaration.name)) {
      this.referencedNames.add(declaration.name);
      this.reference(declaration.type);
    }
  }

  private useEnum(declaration: IEnumDeclaration): void {
    if (!this.referencedNames.has(declaration.name)) {
      this.referencedNames.add(declaration.name);
    }
  }

  private reference(type: SchemaType): void {
    switch (type.type) {
      case 'array': this.reference(type.of); break;

      case 'type-access':
      case 'type-reference': {
        if (!this.referencedNames.has(type.name)) {
          this.use(type.name);
          this.referencedNames.add(type.name);
        }
      } break;

      case 'object': {
        for (const member of type.members || []) {
          this.reference(member.type);
        }
      } break;

      case 'tuple':
      case 'union':
      case 'intersection': {
        for (const subType of type.of) {
          this.reference(subType);
        }
      } break;
    }
  }

  public resolveSourceFile(file: string): string {
    const dir = path.dirname(this.schema.file);
    return path.join(dir, file);
  }
}