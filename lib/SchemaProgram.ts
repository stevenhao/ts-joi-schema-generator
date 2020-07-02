import * as ts from 'typescript';
import * as fs from 'fs-extra';
import * as path from 'path';

import * as Defaults from './defaults';
import { SchemaType, IMemberDeclaration, INamedBinding, BaseSchemaBuilder } from './SchemaBuilders/BaseSchemaBuilder';
import { JoiSchemaBuilder } from './SchemaBuilders/JoiSchemaBuilder';
import { YupSchemaBuilder } from './SchemaBuilders/YupSchemaBuilder';

/** @schema */
export interface ICompilerOptions {
  tscArgs: readonly string[]
  tsconfig?: string
  outDir?: string
  fileSuffix?: string
  schemaSuffix?: string
  render: 'joi' | 'joi-15' | 'yup' | 'yup-0.29'
}

interface IMappedTypeContext {
  [typeName: string]: {
    properties: string[]
    types: {
      [property: string]: SchemaType
    }
  } | undefined
}

interface ICompilerContext {
  schema: BaseSchemaBuilder
  mappedTypeContext: IMappedTypeContext[]
  currentProperty?: ts.PropertySignature | ts.IndexSignatureDeclaration
}

interface ICompilationResult {
  schemaFile: string
  content: string
}

type TagFormat = 'exists' | 'value' | ((value: string) => any)

interface ITagsOptions {
  [key: string]: TagFormat
}

type TagsResult<T extends ITagsOptions> = {
  [K in keyof T]?:
    T[K] extends 'exists' ? boolean :
    T[K] extends 'value' ? string :
    T[K] extends ((value: string) => any) ? ReturnType<T[K]> :
    never
}

export class SchemaProgram {
  private options: ICompilerOptions;

  private program: ts.Program;
  private checker: ts.TypeChecker;
  private tsOptions: ts.CompilerOptions;
  private strictNullChecks: boolean;

  private schemas = new Map<string, BaseSchemaBuilder>();
  private contexts: ICompilerContext[] = [];

  public static compile(options: ICompilerOptions): ICompilationResult[] {
    const config = SchemaProgram.getParsedCommandLine(options);
    const program = ts.createProgram(config.fileNames, config.options);
    const compiler = new SchemaProgram(options, program);
    return compiler.compile();
  }

  private static getParsedCommandLine(options: ICompilerOptions): ts.ParsedCommandLine {
    let pcl = ts.parseCommandLine(options.tscArgs, (path: string) => fs.readFileSync(path, 'utf8'));
    if (pcl.options.project) {
      pcl = ts.getParsedCommandLineOfConfigFile(pcl.options.project, { }, {
        readFile: ts.sys.readFile,
        fileExists: ts.sys.fileExists,
        readDirectory: ts.sys.readDirectory,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        onUnRecoverableConfigFileDiagnostic: () => { /* no-op */ },
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
      }) || pcl;
    }
    delete pcl.options.outDir;
    delete pcl.options.out;
    return pcl;
  }

  private constructor(options: ICompilerOptions, program: ts.Program) {
    this.options = options;
    this.program = program;
    this.checker = program.getTypeChecker();
    this.tsOptions = program.getCompilerOptions();
    this.strictNullChecks = !!this.tsOptions.strict || !!this.tsOptions.strictNullChecks;
  }

  private get context(): ICompilerContext {
    return this.contexts[this.contexts.length - 1];
  }

  private get schema(): BaseSchemaBuilder {
    return this.context.schema;
  }

  private compile(): ICompilationResult[] {
    for (const file of this.program.getRootFileNames()) {
      const sourceFile = this.program.getSourceFile(file)!;
      this.compileNode(sourceFile);
    }

    for (const [, schema] of this.schemas) {
      schema.finalize();
    }

    const result: ICompilationResult[] = [];
    for (const [file, schema] of this.schemas) {
      const content = schema.render();
      if (content) {
        const { dir, name } = path.parse(file);
        const outFile = path.format({ dir: this.options.outDir || dir, name: `${name}${this.options.fileSuffix || Defaults.fileSuffix}`, ext: '.ts' });
        result.push({ schemaFile: path.relative('./', outFile), content: content });
      }
    }
    return result;
  }

  public use(file: string, name: string): void {
    const schema = this.getSchema(file);
    if (schema) {
      schema.use(name);
      return;
    }
    throw new Error(`Couldn't find schema for: ${file}`);
  }

  private getSchema(file: string): BaseSchemaBuilder | undefined {
    const permutations = ['', '.ts'];
    for (const permutation of permutations) {
      const schema = this.schemas.get(`${file}${permutation}`);
      if (schema) {
        return schema;
      }
    }
    return undefined;
  }

  private getName(node: ts.Node): string {
    const symbol = this.checker.getSymbolAtLocation(node);
    return symbol ? symbol.getName() : 'unknown';
  }

  private compileNode(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.SourceFile: return this.compileSourceFile(node as ts.SourceFile);

      case ts.SyntaxKind.EnumDeclaration: return this.compileEnumDeclaration(node as ts.EnumDeclaration);
      case ts.SyntaxKind.InterfaceDeclaration: return this.compileInterfaceDeclaration(node as ts.InterfaceDeclaration);
      case ts.SyntaxKind.TypeAliasDeclaration: return this.compileTypeAliasDeclaration(node as ts.TypeAliasDeclaration);
      case ts.SyntaxKind.ExportDeclaration: return this.compileExportDeclaration(node as ts.ExportDeclaration);
      case ts.SyntaxKind.ImportDeclaration: return this.compileImportDeclaration(node as ts.ImportDeclaration);
    }
    // Skip top-level statements that we haven't handled.
    if (ts.isSourceFile(node.parent!)) { return; }
    console.warn(`compileNode ${ts.SyntaxKind[node.kind]} not supported by ts-joi-schema-generator: ${node.getText()}`);
  }

  private compileOptType(typeNode: ts.Node | undefined): SchemaType {
    return typeNode ? this.compileType(typeNode) : { type: 'any' };
  }

  private compileTypeElements(members: ts.NodeArray<ts.TypeElement>): IMemberDeclaration[] {
    return members.map((member) => this.compileTypeElement(member));
  }

  private compileTypeElement(node: ts.TypeElement): IMemberDeclaration {
    switch (node.kind) {
      case ts.SyntaxKind.PropertySignature: return this.compilePropertySignature(node as ts.PropertySignature);
      case ts.SyntaxKind.IndexSignature: return this.compileIndexSignatureDeclaration(node as ts.IndexSignatureDeclaration);
      case ts.SyntaxKind.MethodSignature: return this.compileMethodSignature(node as ts.MethodSignature);
    }
    throw new Error(`Unsupported type element ${ts.SyntaxKind[node.kind]}: ${node.getText()}`);
  }

  private compilePropertySignature(node: ts.PropertySignature): IMemberDeclaration {
    this.context.currentProperty = node;

    const name = this.getName(node.name);
    const type = this.compileOptType(node.type);

    this.context.currentProperty = undefined;
    return { name, type, required: !node.questionToken };
  }

  private compileIndexSignatureDeclaration(node: ts.IndexSignatureDeclaration): IMemberDeclaration {
    const pattern = this.getTag(node, 'pattern');
    const indexerType = this.compileOptType(node.parameters[0].type);
    this.context.currentProperty = node;

    const type = this.compileOptType(node.type);

    this.context.currentProperty = undefined;
    return {
      type,
      name: 'indexer',
      indexer: (
        indexerType.type === 'string'
          ? { type: 'string', pattern: pattern && pattern.comment ? pattern.comment.trim() : undefined }
          : { type: 'number' }
      ),
      required: !node.questionToken
    };
  }

  private compileMethodSignature(node: ts.MethodSignature): IMemberDeclaration {
    return {
      type: { type: 'func' },
      name: this.getName(node.name),
      required: !node.questionToken,
    };
  }

  private compileTypes(types: ts.NodeArray<ts.Node>): SchemaType[] {
    return types.map((type) => this.compileType(type));
  }

  private compileType(node: ts.Node): SchemaType {
    switch (node.kind) {
      case ts.SyntaxKind.Identifier: return this.compileIdentifier(node as ts.Identifier);
      case ts.SyntaxKind.TypeReference: return this.compileTypeReferenceNode(node as ts.TypeReferenceNode);
      case ts.SyntaxKind.FunctionType: return this.compileFunctionTypeNode(node as ts.FunctionTypeNode);
      case ts.SyntaxKind.TypeLiteral: return this.compileTypeLiteralNode(node as ts.TypeLiteralNode);
      case ts.SyntaxKind.ArrayType: return this.compileArrayTypeNode(node as ts.ArrayTypeNode);
      case ts.SyntaxKind.TupleType: return this.compileTupleTypeNode(node as ts.TupleTypeNode);
      case ts.SyntaxKind.UnionType: return this.compileUnionTypeNode(node as ts.UnionTypeNode);
      case ts.SyntaxKind.OptionalType: return this.compileOptionalType(node as ts.OptionalTypeNode);
      case ts.SyntaxKind.LiteralType: return this.compileLiteralTypeNode(node as ts.LiteralTypeNode);
      case ts.SyntaxKind.IntersectionType: return this.compileIntersectionTypeNode(node as ts.IntersectionTypeNode);
      case ts.SyntaxKind.ParenthesizedType: return this.compileParenthesizedTypeNode(node as ts.ParenthesizedTypeNode);
      case ts.SyntaxKind.ExpressionWithTypeArguments: return this.compileExpressionWithTypeArguments(node as ts.ExpressionWithTypeArguments);
      case ts.SyntaxKind.TypeOperator: return this.compileTypeOperator(node as ts.TypeOperatorNode);
      case ts.SyntaxKind.IndexedAccessType: return this.compileIndexedAccessType(node as ts.IndexedAccessTypeNode);

      case ts.SyntaxKind.AnyKeyword: return { type: 'any' };
      case ts.SyntaxKind.NullKeyword: return { type: 'null' };
      case ts.SyntaxKind.NeverKeyword: return { type: 'never' };
      case ts.SyntaxKind.SymbolKeyword: return { type: 'symbol' };
      case ts.SyntaxKind.ObjectKeyword: return { type: 'object' };
      case ts.SyntaxKind.BooleanKeyword: return { type: 'boolean' };
      case ts.SyntaxKind.UndefinedKeyword: return { type: 'undefined' };
      case ts.SyntaxKind.StringKeyword: return {
        type: 'string',
        ...this.getPropertyTags({ regex: 'value' })
      };
      case ts.SyntaxKind.NumberKeyword: return {
        type: 'number',
        ...this.getPropertyTags({
          integer: 'exists',
          min: this.parseNumber,
          max: this.parseNumber,
        })
      };
    }
    throw new Error(`compileType ${ts.SyntaxKind[node.kind]} not supported by ts-joi-schema-generator: ${node.getText()}`);
  }

  private compileIdentifier(node: ts.Identifier): SchemaType {
    return { type: 'type-reference', name: this.getName(node) };
  }

  private compileTypeReferenceNode(node: ts.TypeReferenceNode): SchemaType {
    if (!node.typeArguments) {
      switch (node.typeName.getText()) {
        case 'Date': return { type: 'date' };
        case 'Buffer': return { type: 'buffer' };
      }
      return this.compileTypeName(node.typeName);
    } else if (node.typeName.getText() === 'Array') {
      return { type: 'array', of: this.compileType(node.typeArguments[0]) };
    } else {
      throw new Error(`Generics are not yet supported by ts-joi-schema-generator: ${node.getText()}`);
    }
  }

  private compileTypeName(node: ts.EntityName): SchemaType {
    switch (node.kind) {
      case ts.SyntaxKind.Identifier: return { type: 'type-reference', name: node.getText() };
      case ts.SyntaxKind.FirstNode: return { type: 'type-access', name: node.left.getText(), access: node.right.getText() };
    }
    throw new Error(`compileTypeName Unknown entityName ${ts.SyntaxKind[node!.kind]}`);
  }

  private compileFunctionTypeNode(_node: ts.FunctionTypeNode): SchemaType {
    return { type: 'func' };
  }

  private compileTypeLiteralNode(node: ts.TypeLiteralNode): SchemaType {
    return {
      type: 'object',
      members: this.compileTypeElements(node.members)
    };
  }

  private compileArrayTypeNode(node: ts.ArrayTypeNode): SchemaType {
    return {
      type: 'array',
      of: this.compileType(node.elementType)
    };
  }

  private compileTupleTypeNode(node: ts.TupleTypeNode): SchemaType {
    return {
      type: 'tuple',
      of: this.compileTypes(node.elementTypes)
    };
  }

  private compileUnionTypeNode(node: ts.UnionTypeNode): SchemaType {
    return {
      type: 'union',
      of: this.compileTypes(node.types)
    };
  }

  private compileLiteralTypeNode(node: ts.LiteralTypeNode): SchemaType {
    return {
      type: 'literal',
      rawLiteral: node.getText()
    };
  }

  private compileParenthesizedTypeNode(node: ts.ParenthesizedTypeNode): SchemaType {
    return this.compileType(node.type);
  }

  private compileIntersectionTypeNode(node: ts.IntersectionTypeNode): SchemaType {
    return {
      type: 'intersection',
      of: this.compileTypes(node.types)
    };
  }

  private compileOptionalType(node: ts.OptionalTypeNode): SchemaType {
    const type = this.compileType(node.type);
    type.required = false;
    return type;
  }

  private compileExpressionWithTypeArguments(node: ts.ExpressionWithTypeArguments): SchemaType {
    if (node.typeArguments) {
      throw new Error('compileExpression Unable to compile type arguments');
    }
    return this.compileType(node.expression);
  }

  private compileTypeOperator(node: ts.TypeOperatorNode): SchemaType {
    switch (node.operator) {
      case ts.SyntaxKind.ReadonlyKeyword: return this.compileType(node.type);
      case ts.SyntaxKind.KeyOfKeyword: {
        const type = this.checker.getTypeFromTypeNode(node.type);
        const properties = this.checker.getPropertiesOfType(type);
        console.log('keyof', node.type.getText(), properties.map(s => s.getName()), type.getStringIndexType());
      }
    }
    throw new Error(`compileTypeOperator Unsupported operator: ${ts.SyntaxKind[node.operator]}`);
  }

  private compileIndexedAccessType(node: ts.IndexedAccessTypeNode): SchemaType {
    const type = this.checker.getTypeFromTypeNode(node);
    return this.compileTsType(type);
  }

  private getFlagString(flags: ts.TypeFlags): string {
    const flagStrings: string[] = [];
    for (let i = 0; i < 32; i++) {
      const flag = 1 << i;
      if (!!(flags & flag) && ts.TypeFlags[flag]) {
        flagStrings.push(ts.TypeFlags[flag]);
      }
    }
    return flagStrings.join(', ');
  }

  private logType(type: ts.Type, pre = ''): void {
    console.log(pre, 'logType: Flags', this.getFlagString(type.flags));
    if (this.hasFlag(type, ts.TypeFlags.EnumLiteral)) {
      console.log(pre, 'logType: Enum Literal', this.checker.typeToString(type));
    }
    if (type.isClass()) {
      console.log(pre, 'logType: Class', type.symbol.getName());
    }
    else if (type.isLiteral()) {
      if (type.symbol) {
        return console.log(pre, 'logType: Literal', this.getName((type.symbol.valueDeclaration.parent as ts.EnumDeclaration).name), type.symbol.getName());
      }
      console.log(pre, 'logType: Literal', JSON.stringify(type.value));
    }
    else if (type.isNumberLiteral()) {
      console.log(pre, 'logType: Number Literal', type.value, type.symbol ? type.symbol.valueDeclaration.getText() : null);
    }
    else if (type.isStringLiteral()) {
      console.log(pre, 'logType: String Literal', type.value, type.symbol ? type.symbol.valueDeclaration.getText() : null);
    }
    else if (type.isUnion()) {
      console.log(pre, `logType: Union ${type.symbol ? type.symbol.getName() : 'Unknown'} ${!!(type.flags & ts.TypeFlags.EnumLike)} ${!!(type.flags & ts.TypeFlags.Null)} (`);
      type.types.forEach((t) => this.logType(t, pre + ' '));
      console.log(pre, ')');
    }
    else if (type.isIntersection()) {
      console.log(pre, 'logType: Intersection (');
      type.types.forEach((t) => this.logType(t, pre + ' '));
      console.log(pre, ')');
    }
    /*else if (type.isTypeParameter) {
      console.log(pre, 'logType: TypeParamter', type.aliasTypeArguments);
    }*/
    else {
      if (pre !== '' && type.symbol && type.symbol.getName() !== '__type') {
        console.log(pre, 'logType: Symbol', type.symbol.getName());
      }
      else {
        switch (type.flags) {
          case ts.TypeFlags.String: console.log(pre, 'logType: String'); break;
          case ts.TypeFlags.Number: console.log(pre, 'logType: Number'); break;
          case ts.TypeFlags.Boolean: console.log(pre, 'logType: Boolean'); break;
          case ts.TypeFlags.Enum: console.log(pre, 'logType: Enum'); break;
          default: {
            console.log(pre, `logType: ${type.symbol ? type.symbol.getName() : 'Other'} -> Flags:`, ts.TypeFlags[type.flags]);
            const props = type.getProperties();
            for (const prop of props) {
              console.log(pre, prop.getName(), '-> (');
              const regex = this.getTag(prop.valueDeclaration, 'regex');
              if (regex) {
                console.log(pre, ' regex:', regex.comment);
              }
              this.logType(this.checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration), pre + ' ');
              console.log(pre, ')');
            }
          }
        }
      }
    }
  }

  private hasFlag(type: ts.Type, flags: ts.TypeFlags): boolean {
    return !!(type.flags & flags);
  }

  private hasFlagGuard<T extends ts.Type>(type: ts.Type, flags: ts.TypeFlags): type is T {
    return this.hasFlag(type, flags);
  }

  private compileTsType(type: ts.Type): SchemaType {
    if (this.hasFlag(type, ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
      return this.compileNonNullableType(type);
    }

    let nullable = false;
    let undefineable = false;

    if (this.strictNullChecks) {
      if (this.hasFlagGuard<ts.UnionType>(type, ts.TypeFlags.Union)) {
        nullable = type.types.some(t => this.hasFlag(t, ts.TypeFlags.Null));
        undefineable = type.types.some(t => this.hasFlag(t, ts.TypeFlags.Undefined));
      }
    }
    else if (type.symbol && type.symbol.valueDeclaration) {
      const result = this.getTags(type.symbol.valueDeclaration, {
        nullable: 'exists',
        undefineable: 'exists'
      });

      nullable = result.nullable || false;
      undefineable = result.undefineable || false;
    }

    const nonNullable = this.checker.getNonNullableType(type);
    const schemaType = this.compileNonNullableType(nonNullable);

    if (nullable || undefineable) {
      return {
        type: 'union',
        of: [
          schemaType,
          ...(nullable ? [{ type: 'null' as const }] : []),
          ...(undefineable ? [{ type: 'undefined' as const }] : []),
        ]
      };
    }
    return schemaType;
  }

  private compileNonNullableType(type: ts.Type): SchemaType {
    if (this.hasFlag(type, ts.TypeFlags.Any)) { return { type: 'any' }; }
    if (this.hasFlag(type, ts.TypeFlags.Unknown)) { return { type: 'unknown' }; }
    if (this.hasFlag(type, ts.TypeFlags.String)) { return { type: 'string' }; }
    if (this.hasFlag(type, ts.TypeFlags.Number)) { return { type: 'number' }; }
    if (this.hasFlag(type, ts.TypeFlags.Boolean)) { return { type: 'boolean' }; }
    if (this.hasFlag(type, ts.TypeFlags.BigInt)) { return { type: 'bigint' }; }
    if (this.hasFlag(type, ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) { return { type: 'symbol' }; }
    if (this.hasFlag(type, ts.TypeFlags.Void)) { return { type: 'void' }; }
    if (this.hasFlag(type, ts.TypeFlags.Undefined)) { return { type: 'undefined' }; }
    if (this.hasFlag(type, ts.TypeFlags.Null)) { return { type: 'null' }; }
    if (this.hasFlag(type, ts.TypeFlags.Never)) { return { type: 'never' }; }
    if (this.hasFlag(type, ts.TypeFlags.String)) { return { type: 'string' }; }

    if (this.hasFlag(type, ts.TypeFlags.EnumLiteral)) {
      const typeString = this.checker.typeToString(type);
      const symbolName = type.symbol.getName();
      if (symbolName === typeString || !typeString.endsWith(`.${symbolName}`)) {
        return {
          type: 'type-reference',
          name: typeString
        };
      }
      return {
        type: 'type-access',
        // typeString ends withs .{symbolName}, so strip that
        name: typeString.slice(0, -(symbolName.length + 1)),
        access: type.symbol.valueDeclaration.getText()
      };
    }

    // boolean is a mess, publapily speaking. Can't get the value, so just convert to string.
    if (this.hasFlag(type, ts.TypeFlags.BooleanLiteral)) {
      return {
        type: 'new-literal',
        value: Boolean(this.checker.typeToString(type))
      };
    }

    // the other literals are nicer
    if (this.hasFlagGuard<ts.LiteralType>(type, ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BigIntLiteral)) {
      return {
        type: 'new-literal',
        value: type.value
      };
    }

    // unions and intersections are alright, luv ya
    if (this.hasFlagGuard<ts.UnionType>(type, ts.TypeFlags.Union)) {
      return {
        type: 'union',
        of: type.types.map(this.compileTsType, this)
      };
    }
    if (this.hasFlagGuard<ts.IntersectionType>(type, ts.TypeFlags.Intersection)) {
      return {
        type: 'intersection',
        of: type.types.map(this.compileTsType, this)
      };
    }

    if (this.hasFlagGuard<ts.ObjectType>(type, ts.TypeFlags.Object)) {
      const symbolName = (type.symbol && type.symbol.getName()) || '__type';
      if (symbolName && symbolName !== '__type') {
        switch (symbolName) {
          // non-primitive versions of le primitives
          case 'Number': return { type: 'number' };
          case 'String': return { type: 'string' };
          case 'Boolean': return { type: 'boolean' };
          case 'BigInt': return { type: 'bigint' };
          case 'Symbol': return { type: 'symbol' };
          case 'Object': return { type: 'object' };

          // Specific to Joi
          case 'Date': return { type: 'date' };
          case 'Buffer': return { type: 'buffer' };

          case 'Array': return {
            type: 'array',
            of: { type: 'any' }
          };
        }
        return { type: 'type-reference', name: symbolName };
      }
      return {
        type: 'object',
        members: type.getProperties().map<IMemberDeclaration>(prop => ({
          required: !(prop.valueDeclaration as ts.PropertyDeclaration).questionToken,
          name: prop.getName(),
          type: this.compileTsType(this.checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration))
        }))
      };
    }
    throw new Error(`compileTsType: Unknown type ${ts.TypeFlags[type.flags] || type.flags}`);
  }

  private compileEnumDeclaration(node: ts.EnumDeclaration): void {
    if (!this.getTag(node, 'noschema')) {
      this.schema.writeEnum({
        name: this.getName(node.name),
        members: node.members.map((member) => ({
          name: member.name.getText(),
          value: this.getTextOfConstantValue(this.checker.getConstantValue(member))
        }))
      }, !!this.getTag(node, 'schema'));
    }
  }

  private compileInterfaceDeclaration(node: ts.InterfaceDeclaration): void {
    if (!this.getTag(node, 'noschema')) {
      if (node.typeParameters) {
        const warning = `Generics are not yet supported by ts-joi-schema-generator: ${this.getName(node.name)}<${node.typeParameters.map((type) => type.getText()).join(', ')}>`;
        if (this.getTag(node, 'schema')) {
          throw new Error(warning);
        }
        console.warn(warning);
        return;
      }

      try {
        const heritageClauses = node.heritageClauses && node.heritageClauses[0].types;
        this.schema.writeInterface({
          name: this.getName(node.name),
          heritages: this.compileTypes(heritageClauses || ts.createNodeArray()),
          members: this.compileTypeElements(node.members)
        }, !!this.getTag(node, 'schema'));
      }
      catch (err) {
        const warning = `Unable to compile interface '${this.getName(node.name)}': ${err}`;
        if (this.getTag(node, 'schema')) {
          throw new Error(warning);
        }
        console.warn(warning);
      }
    }
  }

  private compileTypeAliasDeclaration(node: ts.TypeAliasDeclaration): void {
    if (!this.getTag(node, 'noschema')) {
      try {
        this.schema.writeType({
          name: this.getName(node.name),
          type: this.compileType(node.type)
        }, !!this.getTag(node, 'schema'));
      }
      catch (err) {
        //this.logType(this.checker.getTypeFromTypeNode(node.type), node)
        const warning = `Unable to compile type alias '${this.getName(node.name)}': ${err}`;
        if (this.getTag(node, 'schema')) {
          throw new Error(warning);
        }
        console.warn(warning);
      }
    }
  }

  private compileExportDeclaration(node: ts.ExportDeclaration): void {
    if (node.exportClause) {
      // must have named exports (*'s, etc. nope)
      const namedBindings = node.exportClause;
      if (namedBindings && ts.isNamedExports(namedBindings)) {
        let file: string | undefined = undefined;
        if (node.moduleSpecifier) {
          const rawModuleSpecifier = node.moduleSpecifier.getText();
          const moduleSpecifier = rawModuleSpecifier.substring(1, rawModuleSpecifier.length - 1);

          // must be a file, for now
          if (moduleSpecifier.startsWith('.')) {
            const importedSym = this.checker.getSymbolAtLocation(node.moduleSpecifier);
            if (importedSym && importedSym.declarations) {
              for (const declaration of importedSym.declarations) {
                this.compileNode(declaration);
              }
            }
          }

          file = moduleSpecifier;
        }

        this.schema.writeExport({
          file,
          namedBindings: namedBindings.elements.map<INamedBinding>((element) => {
            return {
              name: element.name.getText(),
              bound: element.propertyName ? element.propertyName.getText() : undefined
            };
          })
        });
      }
    }
  }

  private compileImportDeclaration(node: ts.ImportDeclaration): void {
    if (node.importClause) {
      const rawModuleSpecifier = node.moduleSpecifier.getText();
      const moduleSpecifier = rawModuleSpecifier.substring(1, rawModuleSpecifier.length - 1);

      // must be a file, for now
      if (moduleSpecifier.startsWith('.')) {
        // also must have named imports (default export, nope)
        const namedBindings = node.importClause.namedBindings;
        if (namedBindings && namedBindings.kind === ts.SyntaxKind.NamedImports) {
          this.schema.writeImport({
            file: moduleSpecifier,
            namedBindings: namedBindings.elements.map<INamedBinding>((element) => {
              return {
                name: element.name.getText(),
                bound: element.propertyName ? element.propertyName.getText() : undefined
              };
            })
          });

          const importedSym = this.checker.getSymbolAtLocation(node.moduleSpecifier);
          if (importedSym && importedSym.declarations) {
            for (const declaration of importedSym.declarations) {
              this.compileNode(declaration);
            }
          }
        }
      }
    }
  }

  private compileSourceFileStatements(node: ts.SourceFile): void {
    for (const statement of node.statements) {
      this.compileNode(statement);
    }
  }

  private compileSourceFile(node: ts.SourceFile): void {
    const file = path.resolve(node.fileName);
    const { name } = path.parse(file);

    // let's not crash on mutually importing files, try to not do that tho
    const suffix = this.options.fileSuffix || Defaults.fileSuffix;
    if (!this.schemas.has(file) && (!suffix || !name.endsWith(suffix))) {
      const schema = this.createSchemaBuilder(file);
      const context: ICompilerContext = { schema, mappedTypeContext: [] };
      this.schemas.set(file, schema);

      this.contexts.push(context);
      this.compileSourceFileStatements(node);
      this.contexts.pop();
    }
  }

  private createSchemaBuilder(file: string): BaseSchemaBuilder {
    switch (this.options.render) {
      case 'yup':
      case 'yup-0.29': return new YupSchemaBuilder(this, file, this.options);
      case 'joi':
      case 'joi-15': return new JoiSchemaBuilder(this, file, this.options);
    }
    throw new Error('Invalid render option: ' + this.options.render);
  }

  private getPropertyTags<T extends ITagsOptions>(options: T): TagsResult<T> | undefined {
    return this.context.currentProperty ? this.getTags(this.context.currentProperty, options) : undefined;
  }

  private getTag(node: ts.Node, tagName: string): ts.JSDocTag | undefined {
    const tags = ts.getJSDocTags(node);
    return tags.find((tag) => tag.tagName.escapedText === tagName);
  }

  private getTags<T extends ITagsOptions>(node: ts.Node, options: T): TagsResult<T> {
    const result: TagsResult<T> = {};
    const tags = ts.getJSDocTags(node);
    for (const tag of tags) {
      const key = tag.tagName.escapedText as keyof T;
      const format: TagFormat = options[key];
      if (format) {
        let value: any = undefined;
        switch (format) {
          case 'exists': value = true as any; break;
          case 'value': value = tag.comment && tag.comment.trim(); break;
          default: value = tag.comment ? format(tag.comment) : undefined; break;
        }
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
    return result as TagsResult<T>;
  }

  private parseNumber = (value: string): number | undefined => {
    const num = parseFloat(value);
    if (isNaN(num)) {
      console.warn(`"${value}" is not a valid number`);
      return undefined;
    }
    return num;
  }

  private getTextOfConstantValue(value: string | number | undefined): string {
    // Typescript has methods to escape values, but doesn't seem to expose them at all. Here I am
    // casting `ts` to access this private member rather than implementing my own.
    return value === undefined ? 'undefined' : (ts as any).getTextOfConstantValue(value);
  }
}