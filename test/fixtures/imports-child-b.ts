/** @schema */
export interface ITypeB {}

// import and export on separate lines
import { ITypeC } from './imports-child-c';
export { ITypeC };

// inline export shorthand
export { ITypeD } from './imports-child-d';
