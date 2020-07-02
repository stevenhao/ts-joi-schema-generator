import { ITypeA } from './imports-child-a';
import { ITypeB, ITypeC, ITypeD } from './imports-child-b';

/** @schema */
export interface ITypeAll {
  a: ITypeA
  b: ITypeB
  c: ITypeC
  d: ITypeD
}