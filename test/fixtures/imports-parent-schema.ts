import * as Joi from '@hapi/joi';

import { ITypeASchema } from './imports-child-a-schema';
import { ITypeBSchema, ITypeCSchema, ITypeDSchema } from './imports-child-b-schema';

export const ITypeAllSchema = Joi.object().keys({
  a: Joi.lazy(() => ITypeASchema).required(),
  b: Joi.lazy(() => ITypeBSchema).required(),
  c: Joi.lazy(() => ITypeCSchema).required(),
  d: Joi.lazy(() => ITypeDSchema).required(),
}).required().strict();